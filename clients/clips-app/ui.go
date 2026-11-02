package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"
)

// The page. The app serves one page on 127.0.0.1 and opens the browser on it; the page asks /api/status every
// second or so and starts jobs with POSTs. One job runs at a time.

//go:embed ui/index.html
var indexHTML []byte

const pageCSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; " +
	"img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

// serveUI runs the page until it is quit, or the command is interrupted.
func (a *App) serveUI(ctx context.Context, open bool) error {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	ctx, quit := context.WithCancel(ctx)
	defer quit()
	key := make([]byte, 16)
	if _, err := rand.Read(key); err != nil {
		return err
	}
	token := hex.EncodeToString(key)
	srv := &http.Server{Handler: a.uiHandler(ln.Addr().String(), token, quit), ReadHeaderTimeout: 10 * time.Second}
	u := "http://" + ln.Addr().String() + "/?t=" + token
	if a.out != nil {
		fmt.Fprintf(a.out, "Life Clips %s is running at %s\nKeep this window open while you use it. To stop, press Quit on the page, or Ctrl-C here.\n", version, u)
	}
	if open {
		if err := openBrowser(u); err != nil && a.out != nil {
			fmt.Fprintf(a.out, "Open that address in your browser (%v).\n", err)
		}
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	// a job that runs is stopped, and keeps what it has, before the app goes
	a.mu.Lock()
	if a.cancel != nil {
		a.cancel()
	}
	a.mu.Unlock()
	for i := 0; i < 100 && a.busy(); i++ {
		time.Sleep(100 * time.Millisecond)
	}
	sctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return srv.Shutdown(sctx)
}

func (a *App) busy() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.p.Job != ""
}

// uiHandler serves the page and its API. Only the page this app opened may use it: the Host check keeps out a web
// site that points a name of its own at 127.0.0.1, and the token, which only the address the app opened carries,
// keeps out other pages and other people on the same computer.
func (a *App) uiHandler(host, token string, quit func()) http.Handler {
	_, port, _ := net.SplitHostPort(host)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Security-Policy", pageCSP)
		w.Write(indexHTML)
	})
	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, a.statusView())
	})
	mux.HandleFunc("POST /api/connect", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			SSID     string `json:"ssid"`
			Password string `json:"password"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "the request cannot be read"})
			return
		}
		ssid, pw := strings.TrimSpace(req.SSID), req.Password
		if pw == "" {
			pw = a.rememberedPassword(ssid)
		}
		if err := validWiFi(ssid, pw); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": sentence(err)})
			return
		}
		a.startJob(w, "connect", func(ctx context.Context) error { return a.connect(ctx, ssid, pw) })
	})
	mux.HandleFunc("POST /api/connected", func(w http.ResponseWriter, r *http.Request) { a.startJob(w, "connect", a.lookForNode) })
	mux.HandleFunc("POST /api/fetch", func(w http.ResponseWriter, r *http.Request) { a.startJob(w, "fetch", a.fetch) })
	mux.HandleFunc("POST /api/send", func(w http.ResponseWriter, r *http.Request) { a.startJob(w, "send", a.send) })
	mux.HandleFunc("POST /api/done", func(w http.ResponseWriter, r *http.Request) { a.startJob(w, "done", a.endVisit) })
	mux.HandleFunc("POST /api/stop", func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		if a.cancel != nil {
			a.cancel()
		}
		a.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/quit", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		go quit()
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != host && r.Host != "localhost:"+port {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Token")), []byte(token)) != 1 {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "open Life Clips from the address it printed in its window"})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		mux.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// startJob runs f in the background as the one job of the moment, and answers the page at once.
func (a *App) startJob(w http.ResponseWriter, name string, f func(context.Context) error) {
	a.mu.Lock()
	if a.p.Job != "" {
		job := a.p.Job
		a.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Busy with " + job + "; wait for it, or press Stop."})
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.p.Job, a.p.Doing, a.cancel = name, "", cancel
	a.mu.Unlock()
	go func() {
		defer cancel()
		err := f(ctx)
		switch {
		case err == nil, errors.Is(err, errPartly):
		case errors.Is(err, context.Canceled):
			a.say("info", "Stopped. Everything done so far is kept; press the button again to carry on.")
		default:
			a.say("error", "%s", sentence(err))
		}
		a.mu.Lock()
		a.p.Job, a.p.Doing, a.cancel = "", "", nil
		a.mu.Unlock()
	}()
	writeJSON(w, http.StatusAccepted, map[string]bool{"ok": true})
}

type nodeView struct {
	Name        string  `json:"name"`
	URL         string  `json:"url"`
	Device      string  `json:"device,omitempty"`
	Waiting     int     `json:"waiting"`
	MB          float64 `json:"mb"`
	SecondsLeft *int    `json:"secondsLeft"` // null when the node did not say when the visit ends
}

// statusView is everything the page shows. It never carries a WiFi password.
type statusView struct {
	Version  string    `json:"version"`
	Dir      string    `json:"dir"`
	Job      string    `json:"job"`
	Doing    string    `json:"doing"`
	Node     *nodeView `json:"node"`
	Run      runView   `json:"run"`
	Nodes    []summary `json:"nodes"`
	SSIDs    []string  `json:"ssids"` // WiFi names used before, the most recent first
	Messages []message `json:"messages"`
}

func (a *App) statusView() statusView {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	v := statusView{Version: version, Dir: a.dir, Job: a.p.Job, Doing: a.p.Doing, Run: a.p.Run,
		Nodes: []summary{}, SSIDs: []string{}}
	v.Messages = append([]message{}, a.p.Messages[max(0, len(a.p.Messages)-60):]...) // [] rather than null for the page
	if n := a.p.Node; n != nil {
		h := a.p.Hello
		nv := &nodeView{Name: h.Node, URL: n.base, Waiting: h.Waiting, MB: h.MB}
		if h.Device != nil {
			nv.Device = *h.Device
		}
		if !a.p.Ends.IsZero() {
			left := int(a.p.Ends.Sub(now).Seconds())
			nv.SecondsLeft = &left
		}
		v.Node = nv
	}
	var used []*wifi
	for _, s := range a.allStoresLocked() {
		v.Nodes = append(v.Nodes, s.summary(now))
		if s.WiFi != nil {
			used = append(used, s.WiFi)
		}
	}
	sort.Slice(used, func(i, j int) bool { return used[i].At.After(used[j].At) })
	for _, w := range used {
		if !slices.Contains(v.SSIDs, w.SSID) {
			v.SSIDs = append(v.SSIDs, w.SSID)
		}
	}
	return v
}
