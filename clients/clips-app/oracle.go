package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Sending. Each batch the node signed over is registered with the oracle (POST /clips/batches), which answers with
// the clips it already holds; the others are sent one by one (POST /clips), each with the grant. A clip counts as
// delivered only when the oracle names the SHA-256 of the sound it holds and that is this laptop's own.

var (
	errOffline  = errors.New("the oracle cannot be reached")
	errNotTaken = errors.New("the oracle did not take a clip")
)

// refusedError is the oracle refusing a batch's grant: it is bad, or it has run out.
type refusedError struct{ msg string }

func (e *refusedError) Error() string { return e.msg }

type answer struct {
	OK        bool     `json:"ok"`
	Error     string   `json:"error"`
	Device    string   `json:"device"`
	Have      []string `json:"have"`
	ExpiresAt string   `json:"expiresAt"`
	Created   bool     `json:"created"`
	Replaced  bool     `json:"replaced"`
	SHA256    *string  `json:"sha256"`
	unread    bool     // the answer was not JSON
}

type sendWork struct {
	s  *store
	id string
}

// send registers every batch that is not complete and sends its clips, for every node on this laptop. It works at
// any time the laptop is online, and carries on where it stopped: the oracle names the clips it already holds.
func (a *App) send(ctx context.Context) error {
	a.mu.Lock()
	var todo []sendWork
	n := 0
	for _, s := range a.allStoresLocked() {
		var ids []string
		for id, b := range s.Batches {
			if b.Dead == "" && s.open(b) > 0 {
				ids = append(ids, id)
			}
		}
		slices.SortFunc(ids, func(x, y string) int { return s.Batches[x].At.Compare(s.Batches[y].At) })
		for _, id := range ids {
			todo = append(todo, sendWork{s, id})
			n += s.open(s.Batches[id])
		}
	}
	a.p.Run = runView{Kind: "send", ToSend: n}
	a.mu.Unlock()
	if n == 0 {
		a.say("info", "Nothing is waiting to be sent.")
		return nil
	}
	a.say("info", "Sending %d clips to the oracle.", n)
	partly := false
	for _, w := range todo {
		ok, err := a.sendBatch(ctx, w.s, w.id)
		if err != nil {
			if errors.Is(err, errOffline) {
				a.say("error", "%s", sentence(err))
				return errPartly
			}
			return err
		}
		partly = partly || !ok
	}
	a.mu.Lock()
	run := a.p.Run
	a.mu.Unlock()
	a.say("info", "Sent: the oracle confirmed %d clips; %d did not go through.", run.Sent, run.ToSend-run.Sent)
	if partly {
		return errPartly
	}
	return nil
}

// sendBatch registers one batch and sends its clips. It reports false when the batch or one of its clips did not
// go through for a reason the oracle gave, and an error when the oracle cannot be reached or the run was stopped.
func (a *App) sendBatch(ctx context.Context, s *store, id string) (bool, error) {
	a.mu.Lock()
	b := s.Batches[id]
	grant, items, node := b.Grant, slices.Clone(b.Items), s.Node
	a.mu.Unlock()

	a.doing("Registering batch %s from %s with the oracle", id, node)
	code, ans, err := a.post(ctx, "/clips/batches", grant, func() (io.Reader, string, error) {
		body, err := json.Marshal(map[string]any{"items": items, "laptop": a.laptop})
		return bytes.NewReader(body), "application/json", err
	})
	if err != nil {
		a.mu.Lock()
		b.Problem = err.Error()
		a.mu.Unlock()
		return false, err
	}
	switch {
	case code == http.StatusOK || code == http.StatusCreated:
		a.mu.Lock()
		b.Registered, b.Problem = true, ""
		if ans.ExpiresAt != "" {
			b.ExpiresAt = ans.ExpiresAt
		}
		if ans.Device != "" {
			s.Device = ans.Device
		}
		for _, ref := range ans.Have {
			if slices.ContainsFunc(items, func(it item) bool { return it.Ref == ref }) && a.confirmLocked(s, b, ref) {
				a.p.Run.Sent++
			}
		}
		err := s.save()
		a.mu.Unlock()
		if err != nil {
			return false, err
		}
	case code == http.StatusUnauthorized:
		return false, a.refuse(s, id, "the oracle does not take its grant: "+ans.Error)
	case code == http.StatusConflict:
		return false, a.refuse(s, id, "the oracle says its list does not match the grant, which is a fault in this "+
			"app; please report it ("+ans.Error+")")
	case code == http.StatusBadRequest:
		return false, a.refuse(s, id, "the oracle says its list is not valid: "+ans.Error)
	default:
		a.mu.Lock()
		b.Problem = fmt.Sprintf("the oracle answered %d: %s", code, ans.Error)
		a.mu.Unlock()
		a.say("error", "Batch %s from %s was not registered: the oracle answered %d (%s).", id, node, code, ans.Error)
		return false, nil
	}

	ok := true
	for _, it := range items {
		a.mu.Lock()
		c := s.Clips[it.Ref]
		done := slices.Contains(b.Confirmed, it.Ref) || (c != nil && c.Sent)
		a.mu.Unlock()
		if done {
			continue
		}
		a.doing("Sending clip %s", it.Ref)
		err := a.sendClip(ctx, s, b, grant, it)
		var refused *refusedError
		switch {
		case err == nil:
		case errors.As(err, &refused):
			return false, a.refuse(s, id, "the oracle does not take its grant: "+refused.msg)
		case errors.Is(err, errNotTaken):
			ok = false
		default:
			a.mu.Lock()
			if errors.Is(err, errOffline) {
				b.Problem = err.Error()
			}
			serr := s.save()
			a.mu.Unlock()
			return false, errors.Join(err, serr)
		}
	}
	a.mu.Lock()
	err = s.save()
	a.mu.Unlock()
	return ok, err
}

// refuse marks a batch the oracle will not take. Its clips stay on this laptop and on the node, and at the next
// visit the node signs them over in a new batch.
func (a *App) refuse(s *store, id, why string) error {
	a.mu.Lock()
	b := s.Batches[id]
	b.Dead = why
	left := s.open(b)
	err := s.save()
	a.mu.Unlock()
	a.say("error", "Batch %s from %s was not sent: %s. Its %d clips stay on this laptop and on the node; at the "+
		"next visit the node signs them over again.", id, s.Node, strings.TrimSuffix(why, "."), left)
	return err
}

// confirmLocked notes that the oracle holds this clip with the node's SHA-256, and reports whether that is news.
// Call with a.mu held.
func (a *App) confirmLocked(s *store, b *batch, ref string) bool {
	news := !slices.Contains(b.Confirmed, ref)
	if news {
		b.Confirmed = append(b.Confirmed, ref)
	}
	if c := s.Clips[ref]; c != nil {
		c.Sent, c.Failed = true, ""
	}
	return news
}

// sendClip sends one clip of a batch. It returns nil once the oracle holds this very sound, errNotTaken when the
// oracle will not take it (the reason is noted on the clip), a *refusedError when the oracle no longer takes the
// grant, and any other error when the oracle cannot be reached or the run was stopped.
func (a *App) sendClip(ctx context.Context, s *store, b *batch, grant string, it item) error {
	a.mu.Lock()
	c := s.Clips[it.Ref]
	var facts map[string]string
	var p string
	if c != nil && c.Verified {
		facts, p = c.Facts, s.abs(c)
	}
	a.mu.Unlock()
	if p == "" {
		return a.notTaken(s, it.Ref, "this laptop has no checked copy of it; it is downloaded again at the next visit", false)
	}
	replace, reread := false, false
	for {
		data, err := os.ReadFile(p)
		if err != nil {
			return a.notTaken(s, it.Ref, "its copy on this laptop cannot be read ("+err.Error()+"); it is downloaded "+
				"again at the next visit", true)
		}
		sum := sha256hex(data)
		if sum != it.SHA256 {
			return a.notTaken(s, it.Ref, "its copy on this laptop no longer matches the sound the node signed over; "+
				"it is downloaded again at the next visit", true)
		}
		code, ans, err := a.post(ctx, "/clips", grant, func() (io.Reader, string, error) {
			return clipForm(facts, filepath.Base(p), data, sum, replace)
		})
		if err != nil {
			return err
		}
		held := ""
		if ans.SHA256 != nil {
			held = strings.ToLower(*ans.SHA256)
		}
		switch {
		case ans.unread && code < 300:
			return a.notTaken(s, it.Ref, fmt.Sprintf("the oracle's answer (%d) cannot be read", code), false)
		case (code == http.StatusOK || code == http.StatusCreated) && held == sum:
			a.mu.Lock()
			if a.confirmLocked(s, b, it.Ref) {
				a.p.Run.Sent++
			}
			var err error
			if time.Since(s.saved) > 2*time.Second {
				err = s.save()
			}
			a.mu.Unlock()
			return err
		case code == http.StatusOK && !replace:
			replace = true // the oracle holds another sound for this detection, or none: this one takes its place
		case code == http.StatusOK || code == http.StatusCreated:
			return a.notTaken(s, it.Ref, "the oracle holds a different sound for it", false)
		case code == http.StatusUnprocessableEntity && !reread:
			reread = true // the bytes may have changed between the disk and the oracle; read them again
		case code == http.StatusUnprocessableEntity:
			return a.notTaken(s, it.Ref, "the oracle says the sound does not match its SHA-256, twice", false)
		case code == http.StatusUnauthorized:
			return &refusedError{ans.Error}
		case code == http.StatusForbidden:
			return a.notTaken(s, it.Ref, "the oracle says it is not in the batch the node signed over ("+ans.Error+")", false)
		case code == http.StatusRequestEntityTooLarge:
			return a.notTaken(s, it.Ref, "it is too big for the oracle", false)
		default:
			return a.notTaken(s, it.Ref, fmt.Sprintf("the oracle answered %d (%s)", code, ans.Error), false)
		}
	}
}

// notTaken notes why a clip did not go through. A copy that is bad on this laptop loses its check, so that the
// next visit downloads it again.
func (a *App) notTaken(s *store, ref, why string, badCopy bool) error {
	a.mu.Lock()
	if c := s.Clips[ref]; c != nil {
		c.Failed = why
		if badCopy {
			c.Verified = false
		}
	}
	a.p.Run.NotSent++
	a.mu.Unlock()
	a.say("warn", "Clip %s was not sent: %s.", ref, why)
	return errNotTaken
}

// post sends one request to the oracle with the grant. A network error, a 429 or a 5xx is tried again after a
// growing pause; any other answer is final and comes back with its status.
func (a *App) post(ctx context.Context, path, grant string, body func() (io.Reader, string, error)) (int, answer, error) {
	var last error
	for try := 0; ; try++ {
		rd, ctype, err := body()
		if err != nil {
			return 0, answer{}, err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.oracle+path, rd)
		if err != nil {
			return 0, answer{}, err
		}
		req.Header.Set("Authorization", "Grant "+grant)
		req.Header.Set("Content-Type", ctype)
		req.Header.Set("User-Agent", "life-clips/"+version)
		var after time.Duration
		resp, err := a.oracleHTTP.Do(req)
		switch {
		case err != nil && ctx.Err() != nil:
			return 0, answer{}, ctx.Err()
		case err != nil:
			last = err
		default:
			b, rerr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
			resp.Body.Close()
			switch {
			case rerr != nil:
				last = rerr
			case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
				last = fmt.Errorf("it answered %s", resp.Status)
				after = retryAfter(resp.Header)
			default:
				var ans answer
				if json.Unmarshal(b, &ans) != nil {
					ans = answer{unread: true, Error: strings.TrimSpace(resp.Status)}
				}
				return resp.StatusCode, ans, nil
			}
		}
		if try+1 >= a.tries {
			return 0, answer{}, fmt.Errorf("%w (%v); send again when this laptop is online", errOffline, last)
		}
		if err := a.wait(ctx, try, after); err != nil {
			return 0, answer{}, err
		}
	}
}

// retryAfter is how long the oracle asked to wait, at most a minute.
func retryAfter(h http.Header) time.Duration {
	v := h.Get("Retry-After")
	if s, err := strconv.Atoi(v); err == nil && s > 0 {
		return min(time.Duration(s)*time.Second, time.Minute)
	}
	if t, err := http.ParseTime(v); err == nil {
		return min(max(time.Until(t), 0), time.Minute)
	}
	return 0
}

var quoteEscaper = strings.NewReplacer(`\`, `\\`, `"`, `\"`)

// clipForm is a clip as the oracle takes it: its facts as text fields (a fact the node left empty is left out),
// the SHA-256 of the sound as this laptop has it, and the sound under its own file name, whose extension tells the
// oracle the format.
func clipForm(facts map[string]string, name string, data []byte, sum string, replace bool) (io.Reader, string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for _, k := range factKeys {
		if v := facts[k]; v != "" {
			if err := w.WriteField(k, v); err != nil {
				return nil, "", err
			}
		}
	}
	if err := w.WriteField("sha256", sum); err != nil {
		return nil, "", err
	}
	if replace {
		if err := w.WriteField("replace", "1"); err != nil {
			return nil, "", err
		}
	}
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, quoteEscaper.Replace(name)))
	h.Set("Content-Type", audioType(name))
	part, err := w.CreatePart(h)
	if err != nil {
		return nil, "", err
	}
	if _, err := part.Write(data); err != nil {
		return nil, "", err
	}
	if err := w.Close(); err != nil {
		return nil, "", err
	}
	return &buf, w.FormDataContentType(), nil
}

func audioType(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".m4a", ".mp4":
		return "audio/mp4"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".flac":
		return "audio/flac"
	case ".ogg", ".opus":
		return "audio/ogg"
	}
	return "application/octet-stream"
}

// printStatus is life-clips status: per node, what is on this laptop and how far it got.
func (a *App) printStatus(w io.Writer) error {
	a.mu.Lock()
	var sums []summary
	for _, s := range a.allStoresLocked() {
		sums = append(sums, s.summary(time.Now()))
	}
	a.mu.Unlock()
	fmt.Fprintf(w, "Clips are kept in %s\n", a.dir)
	if len(sums) == 0 {
		fmt.Fprintln(w, "There are no clips from any node on this laptop yet.")
		return nil
	}
	for _, s := range sums {
		fmt.Fprintf(w, "\n%s\n", s.Node)
		if s.SeenAt != nil {
			fmt.Fprintf(w, "  waiting on the node:        %d (at the last visit, %s)\n", s.OnNode, s.SeenAt.Local().Format("2 Jan 2006 15:04"))
		}
		fmt.Fprintf(w, "  downloaded and verified:    %d\n", s.Verified)
		fmt.Fprintf(w, "  handed over to this laptop: %d\n", s.Handed)
		if s.Unsigned > 0 {
			fmt.Fprintf(w, "  not handed over yet:        %d (at the next visit)\n", s.Unsigned)
		}
		fmt.Fprintf(w, "  sent and confirmed:         %d\n", s.Sent)
		fmt.Fprintf(w, "  waiting to be sent:         %d\n", s.ToSend)
		if s.SendBy != nil && s.ToSend > 0 {
			fmt.Fprintf(w, "  send them before:           %s\n", s.SendBy.Local().Format("2 Jan 2006"))
		}
		for _, b := range s.Batches {
			if b.Dead != "" {
				fmt.Fprintf(w, "  batch %s: %s\n", b.ID, b.Dead)
			}
		}
		if len(s.Failed) > 0 {
			fmt.Fprintf(w, "  failed:                     %d\n", len(s.Failed))
			for _, f := range s.Failed {
				fmt.Fprintf(w, "    %s: %s\n", f.Ref, f.Why)
			}
		}
	}
	return nil
}
