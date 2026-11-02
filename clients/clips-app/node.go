package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// The visit. The node serves its waiting clips over its own WiFi (plain HTTP): /api/hello, the list in pages, each
// file, /api/handover, which signs a set of clips over to this laptop as one batch with a grant, and /api/done,
// which ends the visit. The node deletes its copies only once the oracle confirms it has a whole batch, which the
// node hears over its SIM; until then a clip stays on the node, also when this laptop has it.

const (
	pageSize = 1000     // clips per page of the node's list, the most it gives
	maxClip  = 64 << 20 // no clip is near this; a download that runs past it is not a clip
)

type hello struct {
	Version int     `json:"version"`
	Node    string  `json:"node"`
	Device  *string `json:"device"`
	Waiting int     `json:"waiting"`
	MB      float64 `json:"mb"`
	Until   int64   `json:"until"`
}

type nodeConn struct {
	base string
	hc   *http.Client
}

var (
	errGone     = errors.New("it is no longer waiting on the node")
	errMismatch = errors.New("the download does not match its SHA-256")
	grantRe     = regexp.MustCompile(`^lg1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`)
	batchRe     = regexp.MustCompile(`^[A-Za-z0-9_-]{4,64}$`)
)

// diskError is a failure to write on this laptop, which no new download mends.
type diskError struct{ err error }

func (e *diskError) Error() string { return e.err.Error() }
func (e *diskError) Unwrap() error { return e.err }

type diskWriter struct{ f *os.File }

func (w diskWriter) Write(p []byte) (int, error) {
	n, err := w.f.Write(p)
	if err != nil {
		err = &diskError{err}
	}
	return n, err
}

// nodeRefusal is the node's own reason for not signing clips over; it is shown as the node gave it.
type nodeRefusal struct{ msg string }

func (e *nodeRefusal) Error() string { return "the node could not sign the clips over: " + e.msg }

// call does one request to the node and reads its JSON answer into v.
func (n *nodeConn) call(ctx context.Context, method, path string, body, v any, limit time.Duration) (http.Header, error) {
	ctx, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, n.base+path, rd)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := n.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		var e struct{ Error string }
		if json.Unmarshal(b, &e) == nil && e.Error != "" {
			return nil, fmt.Errorf("the node answered %s: %s", resp.Status, e.Error)
		}
		return nil, fmt.Errorf("the node answered %s", resp.Status)
	}
	if err := json.Unmarshal(b, v); err != nil {
		return nil, fmt.Errorf("the node's answer to %s cannot be read: %v", path, err)
	}
	return resp.Header, nil
}

// hello asks the node who it is and when the visit ends. "until" is on the node's clock; the node's Date header
// says what time that clock shows now, so the end of the visit is right on this laptop's clock too, even when one
// of the two clocks is off.
func (n *nodeConn) hello(ctx context.Context, limit time.Duration) (hello, time.Time, error) {
	var h hello
	hdr, err := n.call(ctx, http.MethodGet, "/api/hello", nil, &h, limit)
	if err != nil {
		return h, time.Time{}, err
	}
	if h.Node == "" {
		return h, time.Time{}, errors.New("the node did not say its name")
	}
	var ends time.Time
	if h.Until > 0 {
		now := time.Now()
		nodeNow := now
		if t, err := http.ParseTime(hdr.Get("Date")); err == nil {
			nodeNow = t
		}
		ends = now.Add(time.Unix(h.Until, 0).Sub(nodeNow))
	}
	return h, ends, nil
}

// listed is one waiting clip as the node lists it.
type listed struct {
	Seq    int64
	Ref    string
	File   string
	Bytes  int64
	SHA256 string
	Facts  map[string]string
}

// list reads the node's whole list of waiting clips, page by page. A clip the list cannot describe well enough to
// be checked and signed over is left on the node, and warn says why.
func (n *nodeConn) list(ctx context.Context, warn func(string)) ([]listed, error) {
	var out []listed
	after := int64(0)
	for range 100000 {
		var page struct {
			Clips []map[string]json.RawMessage `json:"clips"`
			Next  *int64                       `json:"next"`
		}
		path := fmt.Sprintf("/api/clips?after=%d&limit=%d", after, pageSize)
		if _, err := n.call(ctx, http.MethodGet, path, nil, &page, time.Minute); err != nil {
			return nil, err
		}
		for _, raw := range page.Clips {
			c, err := parseClip(raw)
			if err != nil {
				warn(err.Error())
				continue
			}
			out = append(out, c)
		}
		if page.Next == nil {
			return out, nil
		}
		if *page.Next <= after {
			return nil, fmt.Errorf("the node's list does not move on (next %d after %d)", *page.Next, after)
		}
		after = *page.Next
	}
	return nil, errors.New("the node's list does not end")
}

func parseClip(raw map[string]json.RawMessage) (listed, error) {
	c := listed{Facts: map[string]string{}}
	for _, k := range factKeys {
		if v, ok := factText(raw[k]); ok {
			c.Facts[k] = v
		}
	}
	c.Ref = c.Facts["detection"]
	// a missing or null number stays 0, which only costs the size check
	_ = json.Unmarshal(raw["seq"], &c.Seq)
	_ = json.Unmarshal(raw["bytes"], &c.Bytes)
	_ = json.Unmarshal(raw["file"], &c.File)
	_ = json.Unmarshal(raw["sha256"], &c.SHA256)
	c.SHA256 = strings.ToLower(c.SHA256)
	switch {
	case c.Ref == "" || len(c.Ref) > 120 || strings.ContainsAny(c.Ref, " \t\r\n"):
		return c, fmt.Errorf("clip %d on the node has no usable detection ref, so it stays on the node", c.Seq)
	case c.File == "":
		return c, fmt.Errorf("clip %s has no file on the node, so it stays there", c.Ref)
	case !sha256Hex.MatchString(c.SHA256):
		return c, fmt.Errorf("clip %s has no SHA-256 on the node, so it stays there", c.Ref)
	}
	return c, nil
}

// factText is a fact as the oracle takes it, as text: a string as it is, a number with the digits the node wrote.
func factText(raw json.RawMessage) (string, bool) {
	raw = bytes.TrimSpace(raw)
	switch {
	case len(raw) == 0 || string(raw) == "null" || raw[0] == '{' || raw[0] == '[':
		return "", false
	case raw[0] == '"':
		var s string
		if json.Unmarshal(raw, &s) != nil {
			return "", false
		}
		s = strings.TrimSpace(s)
		return s, s != ""
	default:
		return string(raw), true
	}
}

// get downloads one clip's sound into w.
func (n *nodeConn) get(ctx context.Context, file string, w io.Writer) (int64, error) {
	u, err := url.Parse(n.base)
	if err != nil {
		return 0, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.JoinPath(file).String(), nil)
	if err != nil {
		return 0, err
	}
	resp, err := n.hc.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return 0, errGone
	case resp.StatusCode != http.StatusOK:
		return 0, fmt.Errorf("the node answered %s", resp.Status)
	}
	return io.Copy(w, io.LimitReader(resp.Body, maxClip))
}

type handoverAnswer struct {
	Batch *string `json:"batch"`
	N     int     `json:"n"`
	Grant *string `json:"grant"`
	Hash  string  `json:"hash"`
	Items []item  `json:"items"`
	Error string  `json:"error"`
}

func (n *nodeConn) handover(ctx context.Context, refs []string, laptop string) (handoverAnswer, error) {
	var ans handoverAnswer
	_, err := n.call(ctx, http.MethodPost, "/api/handover", map[string]any{"refs": refs, "laptop": laptop}, &ans, time.Minute)
	return ans, err
}

func (n *nodeConn) done(ctx context.Context) error {
	var ans struct {
		OK bool `json:"ok"`
	}
	if _, err := n.call(ctx, http.MethodPost, "/api/done", map[string]any{}, &ans, 15*time.Second); err != nil {
		return err
	}
	if !ans.OK {
		return errors.New("the node did not take it")
	}
	return nil
}

// findNode asks the node's addresses for /api/hello, all at once, until one answers or the time is up.
func (a *App) findNode(ctx context.Context, within time.Duration) (*nodeConn, hello, time.Time, error) {
	addrs := nodeAddrs
	if a.nodeURL != "" {
		addrs = []string{a.nodeURL}
	}
	type found struct {
		n    *nodeConn
		h    hello
		ends time.Time
		err  error
	}
	deadline := time.Now().Add(within)
	for {
		ch := make(chan found, len(addrs))
		for _, base := range addrs {
			go func() {
				n := &nodeConn{base: base, hc: a.nodeHTTP}
				h, ends, err := n.hello(ctx, 3*time.Second)
				ch <- found{n, h, ends, err}
			}()
		}
		var last error
		for range addrs {
			if f := <-ch; f.err == nil {
				return f.n, f.h, f.ends, nil
			} else {
				last = f.err
			}
		}
		if ctx.Err() != nil {
			return nil, hello{}, time.Time{}, ctx.Err()
		}
		if time.Now().After(deadline) {
			return nil, hello{}, time.Time{}, fmt.Errorf("no node answers at %s (%v); is this laptop on the node's WiFi?",
				strings.Join(addrs, " or "), last)
		}
		if err := a.wait(ctx, 0, time.Second); err != nil {
			return nil, hello{}, time.Time{}, err
		}
	}
}

// reach is the node this laptop is connected to: the one found when it connected, if it still answers, or else
// whichever answers at the usual addresses.
func (a *App) reach(ctx context.Context) (*nodeConn, hello, time.Time, error) {
	a.mu.Lock()
	n := a.p.Node
	a.mu.Unlock()
	if n != nil {
		if h, ends, err := n.hello(ctx, 5*time.Second); err == nil {
			return n, h, ends, nil
		}
	}
	a.doing("Looking for the node")
	return a.findNode(ctx, 10*time.Second)
}

// connectedLocked notes the node this laptop is on, and what it said. Call with a.mu held.
func (a *App) connectedLocked(s *store, n *nodeConn, h hello, ends time.Time) {
	a.p.Node, a.p.Hello, a.p.Ends = n, h, ends
	if h.Device != nil && *h.Device != "" {
		s.Device = *h.Device
	}
	s.Seen = &seen{Waiting: h.Waiting, MB: h.MB, At: time.Now().UTC()}
}

func (a *App) sayConnected(h hello, ends time.Time) {
	left := ""
	switch {
	case ends.IsZero():
	case time.Until(ends) <= 0:
		left = "; the visit has ended"
	default:
		left = ", " + minutes(time.Until(ends)) + " left in the visit"
	}
	a.say("info", "Connected to %s: %d clips (%.1f MB) waiting%s.", h.Node, h.Waiting, h.MB, left)
}

// connect joins the node's WiFi and waits for the node to answer on it. A WiFi that worked is remembered with the
// node, for the next visit.
func (a *App) connect(ctx context.Context, ssid, password string) error {
	if err := validWiFi(ssid, password); err != nil {
		return err
	}
	a.doing("Joining the WiFi %s", ssid)
	jerr := a.join(ctx, ssid, password)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	within := a.findFor
	if jerr != nil {
		a.say("warn", "Could not join %s from here: %s.", ssid, strings.TrimSuffix(jerr.Error(), "."))
		within = 5 * time.Second // the laptop may be on it already
	}
	a.doing("Waiting for the node to answer")
	n, h, ends, err := a.findNode(ctx, within)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("the node does not answer. Join the WiFi %s by hand (its password is on the node's page in "+
			"the Life Oracle), then press I am connected, or run life-clips fetch again", ssid)
	}
	a.mu.Lock()
	s, err := a.storeFor(h.Node)
	if err == nil {
		s.WiFi = &wifi{SSID: ssid, Password: password, At: time.Now().UTC()}
		a.connectedLocked(s, n, h, ends)
		err = s.save()
	}
	a.mu.Unlock()
	if err != nil {
		return err
	}
	a.sayConnected(h, ends)
	return nil
}

// lookForNode is for a laptop that joined the node's WiFi by hand.
func (a *App) lookForNode(ctx context.Context) error {
	a.doing("Looking for the node")
	n, h, ends, err := a.findNode(ctx, 15*time.Second)
	if err != nil {
		return err
	}
	a.mu.Lock()
	s, err := a.storeFor(h.Node)
	if err == nil {
		a.connectedLocked(s, n, h, ends)
		err = s.save()
	}
	a.mu.Unlock()
	if err != nil {
		return err
	}
	a.sayConnected(h, ends)
	return nil
}

// endVisit tells the node the visit is over, so it can switch off early.
func (a *App) endVisit(ctx context.Context) error {
	n, _, _, err := a.reach(ctx)
	if err != nil {
		return err
	}
	if err := n.done(ctx); err != nil {
		return fmt.Errorf("could not end the visit: %w", err)
	}
	a.mu.Lock()
	a.p.Node = nil
	a.mu.Unlock()
	a.say("info", "The node knows the visit is over and may switch off now.")
	return nil
}

type job struct {
	ref, file, sha, abs string
	bytes               int64
}

type result struct {
	ref string
	err error
}

// fetch is the visit: find the node, read its list, download every clip this laptop does not have yet, each
// checked against its SHA-256, have the node sign the checked clips over in batches of at most a.chunk, and tell
// it the visit is over. It may be stopped at any point and run again: what is downloaded and checked is never
// fetched twice, and a grant is on disk before the next step starts.
func (a *App) fetch(ctx context.Context) error {
	n, h, ends, err := a.reach(ctx)
	if err != nil {
		return err
	}
	a.mu.Lock()
	s, err := a.storeFor(h.Node)
	if err == nil {
		a.connectedLocked(s, n, h, ends)
	}
	a.mu.Unlock()
	if err != nil {
		return err
	}
	if h.Device == nil || *h.Device == "" {
		a.say("warn", "The node does not know its id on the oracle yet, so it may not be able to sign the clips over. "+
			"The download goes ahead; it learns its id from the oracle's answer to its next post.")
	}
	a.doing("Reading the node's list of clips")
	list, err := n.list(ctx, func(m string) { a.say("warn", "%s", sentence(errors.New(m))) })
	if err != nil {
		return fmt.Errorf("could not read the node's list of clips: %w", err)
	}
	todo, ready := a.plan(s, list)
	a.mu.Lock()
	a.p.Run = runView{Kind: "fetch", Total: len(todo)}
	a.mu.Unlock()
	if len(todo) > 0 {
		a.say("info", "Downloading %d clips from %s.", len(todo), h.Node)
	} else {
		a.say("info", "This laptop already has every clip waiting on %s.", h.Node)
	}

	var stopAt time.Time
	if !ends.IsZero() {
		stopAt = ends.Add(-a.reserve)
	}
	jobs := make(chan job)
	results := make(chan result)
	halt := make(chan struct{})
	var haltOnce sync.Once
	stop := func() { haltOnce.Do(func() { close(halt) }) }
	var wg sync.WaitGroup
	for range a.workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				results <- result{j.ref, a.download(ctx, n, j)}
			}
		}()
	}
	late := false // written before jobs closes, read after results closes
	go func() {
		defer close(jobs)
		for _, j := range todo {
			if !stopAt.IsZero() && time.Now().After(stopAt) {
				late = true
				return
			}
			select {
			case jobs <- j:
			case <-halt:
				return
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() { wg.Wait(); close(results) }()

	var handErr, diskErr, netErr error
	unreachable := 0
	for r := range results {
		a.mu.Lock()
		c := s.Clips[r.ref]
		var de *diskError
		switch {
		case r.err == nil:
			c.Verified, c.Failed = true, ""
			a.p.Run.Got++
			unreachable = 0
			ready = append(ready, r.ref)
		case errors.Is(r.err, errGone):
			a.p.Run.Gone++
			if c.Batch == "" && !c.Sent {
				delete(s.Clips, r.ref)
			}
		case errors.Is(r.err, errMismatch):
			c.Failed = "the download did not match its SHA-256, twice; it stays on the node"
			a.p.Run.Failed++
		case ctx.Err() != nil:
		case errors.As(r.err, &de):
			diskErr = r.err
		default:
			unreachable++
			netErr = r.err
		}
		if a.out != nil && r.err == nil && (a.p.Run.Got%100 == 0 || a.p.Run.Got == a.p.Run.Total) {
			fmt.Fprintf(a.out, "%d of %d downloaded\n", a.p.Run.Got, a.p.Run.Total)
		}
		if time.Since(s.saved) > 2*time.Second {
			if err := s.save(); err != nil {
				diskErr = err
			}
		}
		a.mu.Unlock()
		if diskErr != nil || unreachable >= 3 {
			stop()
		}
		if handErr == nil && len(ready) >= a.chunk {
			handErr = a.handOver(ctx, n, s, ready[:a.chunk])
			ready = ready[a.chunk:]
		}
	}
	a.mu.Lock()
	if err := s.save(); err != nil && diskErr == nil {
		diskErr = err
	}
	run := a.p.Run
	a.mu.Unlock()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if diskErr != nil {
		return fmt.Errorf("could not write to %s: %w", s.dir, diskErr)
	}
	if late {
		a.say("warn", "The visit ends in under %s, so downloading stops here and the node signs over what this laptop "+
			"has. The other clips stay on the node until the next visit.", minutes(a.reserve))
	}
	lost := unreachable >= 3
	if lost {
		a.say("error", "The node stopped answering (%v). The visit may be over, or this laptop left the node's WiFi. "+
			"What is not downloaded yet stays on the node.", netErr)
	}
	for handErr == nil && len(ready) > 0 {
		k := min(a.chunk, len(ready))
		handErr = a.handOver(ctx, n, s, ready[:k])
		ready = ready[k:]
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if run.Got > 0 || run.Failed > 0 || run.Gone > 0 {
		a.say("info", "Downloaded and checked %d clips; %d did not match their SHA-256 and stay on the node; "+
			"%d had already left the node.", run.Got, run.Failed, run.Gone)
	}
	var refusal *nodeRefusal
	switch {
	case errors.As(handErr, &refusal):
		a.say("error", "The node could not sign the clips over: %s. They are safe on this laptop and stay on the "+
			"node; press Download again before the visit ends, or come back at the next visit.", refusal.msg)
		return errPartly
	case handErr != nil:
		a.say("error", "The clips could not be signed over (%v). They are safe on this laptop and stay on the "+
			"node; at the next visit they are signed over without being downloaded again.", handErr)
		return errPartly
	case lost:
		return errPartly
	}
	a.doing("Telling the node the visit is over")
	if err := n.done(ctx); err != nil {
		a.say("warn", "Could not tell the node the visit is over (%v); it ends by itself at the set time.", err)
	} else {
		a.mu.Lock()
		a.p.Node = nil
		a.mu.Unlock()
		a.say("info", "The node knows the visit is over and may switch off now.")
	}
	if run.Failed > 0 {
		return errPartly
	}
	return nil
}

// plan brings the node's list into the state, and returns what is still to download and which checked clips wait
// for the node's signature. A file already in its place that matches its SHA-256 counts as downloaded: the app may
// have stopped after a download and before it could note it.
func (a *App) plan(s *store, list []listed) (todo []job, ready []string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	used := map[string]string{}
	for ref, c := range s.Clips {
		if c.Path != "" {
			used[strings.ToLower(c.Path)] = ref
		}
	}
	for _, l := range list {
		c := s.Clips[l.Ref]
		if c == nil {
			c = &clip{}
			s.Clips[l.Ref] = c
		}
		if c.Verified && c.SHA256 != l.SHA256 && c.Batch == "" && !c.Sent {
			c.Verified = false // the node holds another sound under this ref now; that one is wanted
		}
		if !c.Verified {
			c.SHA256, c.Bytes = l.SHA256, l.Bytes
		}
		c.Seq, c.File, c.Facts, c.Gone = l.Seq, l.File, l.Facts, false
		if c.Path == "" {
			c.Path = s.pathFor(l.Ref, c, used)
			used[strings.ToLower(c.Path)] = l.Ref
		}
		p := s.abs(c)
		if c.Verified {
			if fi, err := os.Stat(p); err != nil || (c.Bytes > 0 && fi.Size() != c.Bytes) {
				c.Verified = false // the copy went missing on this laptop, or changed
			}
		} else if sum, size, err := hashFile(p); err == nil && sum == c.SHA256 && (c.Bytes == 0 || size == c.Bytes) {
			c.Verified, c.Failed = true, ""
		}
		switch {
		case !c.Verified:
			todo = append(todo, job{ref: l.Ref, file: c.File, sha: c.SHA256, abs: p, bytes: c.Bytes})
		case !c.Sent && !s.signed(c.Batch, now):
			ready = append(ready, l.Ref)
		}
	}
	return todo, ready
}

// download fetches one clip into its place, checked against the size and SHA-256 the node listed. A mismatch is
// downloaded once more before the clip counts as failed. A dropped connection is tried again a few times: at the
// edge of the node's WiFi a laptop loses packets more often than the whole link.
func (a *App) download(ctx context.Context, n *nodeConn, j job) error {
	if err := os.MkdirAll(filepath.Dir(j.abs), 0o755); err != nil {
		return &diskError{err}
	}
	mismatches, drops := 0, 0
	for {
		err := a.downloadOnce(ctx, n, j)
		var de *diskError
		switch {
		case err == nil, errors.Is(err, errGone), ctx.Err() != nil, errors.As(err, &de):
			return err
		case errors.Is(err, errMismatch):
			if mismatches++; mismatches >= 2 {
				return err
			}
		default:
			if drops++; drops >= 3 {
				return err
			}
			if err := a.wait(ctx, drops-1, 0); err != nil {
				return err
			}
		}
	}
}

// downloadOnce writes the sound to <path>.part while hashing it, and renames it into place only when it matches:
// a file in its place is always a checked one.
func (a *App) downloadOnce(ctx context.Context, n *nodeConn, j job) error {
	part := j.abs + ".part"
	f, err := os.Create(part)
	if err != nil {
		return &diskError{err}
	}
	h := sha256.New()
	size, err := n.get(ctx, j.file, io.MultiWriter(diskWriter{f}, h))
	if cerr := f.Close(); err == nil && cerr != nil {
		err = &diskError{cerr}
	}
	switch {
	case err != nil:
	case (j.bytes > 0 && size != j.bytes) || hex.EncodeToString(h.Sum(nil)) != j.sha:
		err = errMismatch
	default:
		if err = os.Rename(part, j.abs); err != nil {
			err = &diskError{err}
		}
	}
	if err != nil {
		os.Remove(part)
	}
	return err
}

// handOver asks the node to sign these checked clips over to this laptop as one batch. The grant goes to disk
// before anything else happens: it is what lets these clips reach the oracle.
func (a *App) handOver(ctx context.Context, n *nodeConn, s *store, refs []string) error {
	a.doing("Asking the node to sign %d clips over to this laptop", len(refs))
	ans, err := n.handover(ctx, refs, a.laptop)
	if err != nil {
		return err
	}
	asked := make(map[string]bool, len(refs))
	for _, r := range refs {
		asked[r] = true
	}
	signed := ans.Batch != nil && ans.Grant != nil
	switch {
	case !signed && ans.Error != "":
		return &nodeRefusal{ans.Error}
	case !signed:
		ans.Items = nil // none of these clips is on the node any more
	case !batchRe.MatchString(*ans.Batch) || !grantRe.MatchString(*ans.Grant) || len(ans.Items) == 0:
		return errors.New("the node's answer to the handover cannot be read")
	}
	for _, it := range ans.Items {
		if !asked[it.Ref] || !sha256Hex.MatchString(it.SHA256) {
			return fmt.Errorf("the node signed over a clip this laptop did not ask for (%s)", it.Ref)
		}
	}
	a.mu.Lock()
	in := map[string]bool{}
	if signed {
		s.Batches[*ans.Batch] = &batch{Grant: *ans.Grant, Hash: ans.Hash, Items: ans.Items, At: time.Now().UTC(),
			Laptop: a.laptop, ExpiresAt: grantExpiry(*ans.Grant)}
		for _, it := range ans.Items {
			in[it.Ref] = true
			if c := s.Clips[it.Ref]; c != nil {
				c.Batch = *ans.Batch
			}
		}
		a.p.Run.Handed += len(ans.Items)
	}
	for _, r := range refs {
		if c := s.Clips[r]; c != nil && !in[r] {
			c.Gone = true
		}
	}
	err = s.save()
	a.mu.Unlock()
	if err != nil {
		return err
	}
	if signed {
		a.say("info", "The node signed %d clips over to this laptop (batch %s).", len(ans.Items), *ans.Batch)
	}
	if gone := len(refs) - len(ans.Items); gone > 0 {
		a.say("info", "%d clips had already left the node another way, so they are not in the batch.", gone)
	}
	return nil
}

// grantExpiry reads when a grant runs out from its payload (lg1.<payload>.<signature>), to show before the oracle
// has seen the batch. Checking the signature is the oracle's business.
func grantExpiry(g string) string {
	parts := strings.Split(g, ".")
	if len(parts) != 3 {
		return ""
	}
	b, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var p struct {
		E float64 `json:"e"`
	}
	if json.Unmarshal(b, &p) != nil || p.E <= 0 {
		return ""
	}
	return time.Unix(int64(p.E), 0).UTC().Format(time.RFC3339)
}
