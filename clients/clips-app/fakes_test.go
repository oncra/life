package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// A fake node and a fake oracle, each keeping its side of the contract the way the real ones do: the node's clip
// server (node/life-clips.py behind life-visit) and the oracle's /clips and /clips/batches (src/lib/grant.ts).

const testNode = "life-x7k2qp"

type fakeClip struct {
	seq  int64
	ref  string
	file string
	data []byte
}

func makeClips(n int) []*fakeClip {
	cs := make([]*fakeClip, n)
	for i := range n {
		id := 1000 + i
		cs[i] = &fakeClip{
			seq:  int64(i + 1),
			ref:  fmt.Sprintf("%d@1778728329", id),
			file: fmt.Sprintf("clips/2026-05/20260514-0512%02d_limosa_limosa_0_8_%d.m4a", i%60, id),
			data: []byte(fmt.Sprintf("the sound of detection %d, a black-tailed godwit", id)),
		}
	}
	return cs
}

func clipJSON(c *fakeClip) map[string]any {
	return map[string]any{
		"seq": c.seq, "file": c.file, "bytes": len(c.data), "sha256": sha256hex(c.data),
		"detection": c.ref, "time_utc": "2026-05-14T03:12:09+00:00", "scientific": "Limosa limosa",
		"score": "0.812", "band": "0.8", "detector": "birdnet-go", "source": "AudioMoth",
		"clip_s": json.Number("7.0"), "detection_from_s": json.Number("0.0"), "detection_to_s": json.Number("3.0"),
		"expansion": nil, "gain_db": 11.5,
	}
}

// itemsHash is a batch's fingerprint as the node and the oracle compute it: SHA-256 over "ref sha256\n" per clip,
// sorted by ref.
func itemsHash(items []item) string {
	s := append([]item(nil), items...)
	sort.Slice(s, func(i, j int) bool {
		if s[i].Ref != s[j].Ref {
			return s[i].Ref < s[j].Ref
		}
		return s[i].SHA256 < s[j].SHA256
	})
	h := sha256.New()
	for _, it := range s {
		fmt.Fprintf(h, "%s %s\n", it.Ref, it.SHA256)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func makeGrant(key []byte, device, batch string, n int, hash string, exp time.Time) string {
	payload, _ := json.Marshal(map[string]any{"v": 1, "d": device, "b": batch, "n": n, "h": hash, "e": exp.Unix()})
	p := base64.RawURLEncoding.EncodeToString(payload)
	m := hmac.New(sha256.New, key)
	m.Write([]byte(p))
	return "lg1." + p + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

type grantInfo struct {
	D, B, H string
	N       int
	E       int64
}

var grantHeader = regexp.MustCompile(`^Grant (lg1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+))$`)

// readGrant checks an Authorization header the way the oracle does: the signature under the node's key, and the
// clock.
func readGrant(key []byte, auth string) (grantInfo, bool) {
	m := grantHeader.FindStringSubmatch(auth)
	if m == nil {
		return grantInfo{}, false
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(m[2]))
	sig, err := base64.RawURLEncoding.DecodeString(m[3])
	if err != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		return grantInfo{}, false
	}
	b, _ := base64.RawURLEncoding.DecodeString(m[2])
	var g struct {
		D string `json:"d"`
		B string `json:"b"`
		N int    `json:"n"`
		H string `json:"h"`
		E int64  `json:"e"`
	}
	if json.Unmarshal(b, &g) != nil || time.Unix(g.E, 0).Before(time.Now()) {
		return grantInfo{}, false
	}
	return grantInfo{g.D, g.B, g.H, g.N, g.E}, true
}

type fakeNode struct {
	key []byte

	mu      sync.Mutex
	clips   []*fakeClip
	device  string // empty: the node does not know its id on the oracle yet
	until   int64
	calls   []string
	afters  []string
	limits  []string
	gets    map[string]int
	corrupt map[string]int  // file: how many more times it is served damaged; -1 for always
	missing map[string]bool // files that answer 404
	served  int
	onServe func(served int)
	handed  [][]string // the refs of each handover, in order
	laptops []string
	batches []string
	grants  map[string]string
	items   map[string][]item
	done    int
}

func (f *fakeNode) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/hello":
		f.mu.Lock()
		f.calls = append(f.calls, "hello")
		var dev any
		if f.device != "" {
			dev = f.device
		}
		body := map[string]any{"version": 1, "node": testNode, "device": dev, "waiting": len(f.clips), "mb": 112.6, "until": f.until}
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, body)

	case r.Method == http.MethodGet && r.URL.Path == "/api/clips":
		q := r.URL.Query()
		after, _ := strconv.ParseInt(q.Get("after"), 10, 64)
		limit, _ := strconv.Atoi(q.Get("limit"))
		if limit < 1 || limit > 1000 {
			limit = 1000
		}
		f.mu.Lock()
		f.calls = append(f.calls, "clips")
		f.afters = append(f.afters, q.Get("after"))
		f.limits = append(f.limits, q.Get("limit"))
		page := []map[string]any{}
		var next any
		for _, c := range f.clips {
			if c.seq <= after {
				continue
			}
			if len(page) == limit {
				next = page[len(page)-1]["seq"]
				break
			}
			page = append(page, clipJSON(c))
		}
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"clips": page, "next": next})

	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/clips/"):
		file := strings.TrimPrefix(r.URL.Path, "/")
		f.mu.Lock()
		f.gets[file]++
		var data []byte
		for _, c := range f.clips {
			if c.file == file && !f.missing[file] {
				data = c.data
			}
		}
		if n := f.corrupt[file]; n != 0 && data != nil {
			data = bytes.Clone(data)
			data[0] ^= 0xff
			if n > 0 {
				f.corrupt[file] = n - 1
			}
		}
		f.mu.Unlock()
		if data == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		w.Write(data)
		f.mu.Lock()
		f.served++
		n, hook := f.served, f.onServe
		f.mu.Unlock()
		if hook != nil {
			hook(n)
		}

	case r.Method == http.MethodPost && r.URL.Path == "/api/handover":
		var req struct {
			Refs   []string `json:"refs"`
			Laptop string   `json:"laptop"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Laptop == "" || len(req.Refs) == 0 || len(req.Refs) > 2000 {
			http.Error(w, "a handover is 1 to 2000 refs and the laptop's name", http.StatusBadRequest)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		f.calls = append(f.calls, "handover")
		f.handed = append(f.handed, req.Refs)
		f.laptops = append(f.laptops, req.Laptop)
		if f.device == "" {
			writeJSON(w, http.StatusOK, map[string]any{"batch": nil, "n": 0, "grant": nil,
				"error": "the node does not know its own id yet: it learns it from the oracle's answer to its next heartbeat"})
			return
		}
		want := map[string]bool{}
		for _, ref := range req.Refs {
			want[ref] = true
		}
		var items []item
		for _, c := range f.clips {
			if want[c.ref] && !f.missing[c.file] {
				items = append(items, item{c.ref, sha256hex(c.data)})
			}
		}
		if len(items) == 0 {
			writeJSON(w, http.StatusOK, map[string]any{"batch": nil, "n": 0, "grant": nil})
			return
		}
		sort.Slice(items, func(i, j int) bool { return items[i].Ref < items[j].Ref })
		id := fmt.Sprintf("b%011d", len(f.batches)+1)
		hash := itemsHash(items)
		grant := makeGrant(f.key, f.device, id, len(items), hash, time.Now().Add(90*24*time.Hour))
		f.batches = append(f.batches, id)
		f.grants[id], f.items[id] = grant, items
		writeJSON(w, http.StatusOK, map[string]any{"batch": id, "n": len(items), "grant": grant, "hash": hash, "items": items})

	case r.Method == http.MethodPost && r.URL.Path == "/api/done":
		f.mu.Lock()
		f.calls = append(f.calls, "done")
		f.done++
		f.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	default:
		http.NotFound(w, r)
	}
}

// sentForm is one POST /clips as the oracle received it.
type sentForm struct {
	values map[string][]string
	files  []string // the field names of the file parts
	name   string
	ctype  string
	data   []byte
}

type fakeOracle struct {
	key []byte

	mu      sync.Mutex
	batches map[string][]item // registered
	held    map[string]string // ref: SHA-256 of the sound held; "" for a row without its sound
	noHave  bool              // leave "have" empty, as if the oracle got a clip between registration and send
	refuse  map[string]string // batch: why its grant is refused (401)
	fail    map[string]int    // ref: 503s before the clip is taken
	failReg int               // 503s before a batch registration is taken
	bad     map[string]int    // ref: 422s whatever the sound
	posts   map[string]int
	forms   map[string][]sentForm
	auths   []string
	regs    []map[string]json.RawMessage
}

func (o *fakeOracle) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.auths = append(o.auths, r.Header.Get("Authorization"))
	g, ok := readGrant(o.key, r.Header.Get("Authorization"))
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "the grant is not signed by this node"})
		return
	}
	if msg := o.refuse[g.B]; msg != "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": msg})
		return
	}
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/clips/batches":
		o.register(w, r, g)
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/clips":
		o.clip(w, r, g)
	default:
		http.NotFound(w, r)
	}
}

func (o *fakeOracle) register(w http.ResponseWriter, r *http.Request, g grantInfo) {
	if o.failReg > 0 {
		o.failReg--
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "busy"})
		return
	}
	var body map[string]json.RawMessage
	var items []item
	var laptop string
	if json.NewDecoder(r.Body).Decode(&body) != nil || json.Unmarshal(body["items"], &items) != nil ||
		json.Unmarshal(body["laptop"], &laptop) != nil || len(items) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "items: 1 to 5000 of {ref, sha256}, each ref once"})
		return
	}
	o.regs = append(o.regs, body)
	if len(items) != g.N || itemsHash(items) != g.H {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "these are not the clips the node signed over"})
		return
	}
	_, known := o.batches[g.B]
	o.batches[g.B] = items
	have := []string{}
	for _, it := range items {
		if sha, ok := o.held[it.Ref]; ok && sha == it.SHA256 && !o.noHave {
			have = append(have, it.Ref)
		}
	}
	code := http.StatusCreated
	if known {
		code = http.StatusOK
	}
	writeJSON(w, code, map[string]any{"ok": true, "device": g.D, "batch": g.B, "n": g.N, "have": have,
		"expiresAt": time.Unix(g.E, 0).UTC().Format("2006-01-02T15:04:05.000Z")})
}

func first(v []string) string {
	if len(v) == 0 {
		return ""
	}
	return v[0]
}

func (o *fakeOracle) clip(w http.ResponseWriter, r *http.Request, g grantInfo) {
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "send multipart/form-data"})
		return
	}
	form := r.MultipartForm
	ref := first(form.Value["detection"])
	sent := sentForm{values: map[string][]string{}}
	for k, v := range form.Value {
		sent.values[k] = v
	}
	for k := range form.File {
		sent.files = append(sent.files, k)
	}
	fhs := form.File["file"]
	if len(fhs) != 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file is missing"})
		return
	}
	f, err := fhs[0].Open()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	data, _ := io.ReadAll(f)
	f.Close()
	sent.name, sent.ctype, sent.data = fhs[0].Filename, fhs[0].Header.Get("Content-Type"), data
	o.posts[ref]++
	o.forms[ref] = append(o.forms[ref], sent)
	sum := sha256hex(data)
	if said := first(form.Value["sha256"]); said != "" && said != sum {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "the sound does not match its sha256", "sha256": sum})
		return
	}
	if o.bad[ref] > 0 {
		o.bad[ref]--
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "the sound does not match its sha256", "sha256": sum})
		return
	}
	in := false
	for _, it := range o.batches[g.B] {
		in = in || (it.Ref == ref && it.SHA256 == sum)
	}
	if !in {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "this clip is not in the batch the node signed over"})
		return
	}
	if o.fail[ref] > 0 {
		o.fail[ref]--
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "busy"})
		return
	}
	held, has := o.held[ref]
	if has && first(form.Value["replace"]) != "1" {
		var s any
		if held != "" {
			s = held
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": "c-" + ref, "created": false, "sha256": s})
		return
	}
	o.held[ref] = sum
	if has {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": "c-" + ref, "created": false, "replaced": true, "sha256": sum})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "id": "c-" + ref, "created": true, "sha256": sum})
}

// rig is a fake node and a fake oracle on loopback, and a clips folder.
type rig struct {
	t         *testing.T
	dir       string
	node      *fakeNode
	oracle    *fakeOracle
	nodeURL   string
	oracleURL string
}

func newRig(t *testing.T, clips []*fakeClip) *rig {
	t.Helper()
	key := []byte("the sha256 of the node's token")
	fn := &fakeNode{key: key, clips: clips, device: "cmvisualnode0001x7k2qp", until: time.Now().Add(25 * time.Minute).Unix(),
		gets: map[string]int{}, corrupt: map[string]int{}, missing: map[string]bool{}, grants: map[string]string{}, items: map[string][]item{}}
	fo := &fakeOracle{key: key, batches: map[string][]item{}, held: map[string]string{}, refuse: map[string]string{},
		fail: map[string]int{}, bad: map[string]int{}, posts: map[string]int{}, forms: map[string][]sentForm{}}
	ns := httptest.NewServer(fn)
	t.Cleanup(ns.Close)
	osrv := httptest.NewServer(fo)
	t.Cleanup(osrv.Close)
	return &rig{t: t, dir: t.TempDir(), node: fn, oracle: fo, nodeURL: ns.URL, oracleURL: osrv.URL + "/api/v1"}
}

// still runs fn while neither fake can handle a request, so that a test reads and sets what they keep without
// racing their handlers.
func (r *rig) still(fn func()) {
	r.node.mu.Lock()
	defer r.node.mu.Unlock()
	r.oracle.mu.Lock()
	defer r.oracle.mu.Unlock()
	fn()
}

// app is the app starting on the rig's folder, as it would after a restart.
func (r *rig) app() *App {
	r.t.Helper()
	a, err := newApp(r.dir, r.nodeURL, r.oracleURL)
	if err != nil {
		r.t.Fatal(err)
	}
	a.laptop = "field-laptop"
	a.pause = time.Millisecond
	a.join = func(context.Context, string, string) error { return errByHand }
	return a
}

// state is the node's state file as it is on disk.
func (r *rig) state() state {
	r.t.Helper()
	b, err := os.ReadFile(filepath.Join(r.dir, testNode, stateFile))
	if err != nil {
		r.t.Fatal(err)
	}
	var s state
	if err := json.Unmarshal(b, &s); err != nil {
		r.t.Fatal(err)
	}
	return s
}

func messages(a *App) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	var b strings.Builder
	for _, m := range a.p.Messages {
		b.WriteString(m.Text + "\n")
	}
	return b.String()
}

func summaryOf(a *App) summary {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, s := range a.allStoresLocked() {
		if s.Node == testNode {
			return s.summary(time.Now())
		}
	}
	return summary{}
}
