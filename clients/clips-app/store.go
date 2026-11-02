package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"
)

// A node's clips on this laptop live in <dir>/<node>/: each sound under <YYYY-MM>/<the node's file name>, and
// state.json beside them with each clip's facts, whether its copy is checked, the batch the node signed it over in,
// and per batch the grant and the clips the oracle confirmed. The grants exist nowhere else on this laptop, so the
// file is always replaced whole (a new file, then a rename) and written at once after every handover.

const stateFile = "state.json"

// factKeys are the facts of a clip that go to the oracle with it, in the order they are sent.
var factKeys = []string{"detection", "time_utc", "scientific", "score", "band", "detector", "source", "clip_s",
	"detection_from_s", "detection_to_s", "expansion", "gain_db"}

type clip struct {
	Seq      int64             `json:"seq"`
	File     string            `json:"file"` // the node's path for it, which is also where it is downloaded from
	Bytes    int64             `json:"bytes,omitempty"`
	SHA256   string            `json:"sha256"`
	Facts    map[string]string `json:"facts"` // as text, the way the oracle takes them; a null is left out
	Path     string            `json:"path,omitempty"`
	Verified bool              `json:"verified,omitempty"`
	Batch    string            `json:"batch,omitempty"`
	Sent     bool              `json:"sent,omitempty"`   // the oracle holds this very sound
	Failed   string            `json:"failed,omitempty"` // why the last try gave up
	Gone     bool              `json:"gone,omitempty"`   // it had left the node when the node signed the others over
}

type item struct {
	Ref    string `json:"ref"`
	SHA256 string `json:"sha256"`
}

type batch struct {
	Grant      string    `json:"grant"`
	Hash       string    `json:"hash,omitempty"`
	Items      []item    `json:"items"` // exactly as the node signed them
	At         time.Time `json:"at"`
	Laptop     string    `json:"laptop,omitempty"`
	ExpiresAt  string    `json:"expiresAt,omitempty"`
	Registered bool      `json:"registered,omitempty"`
	Confirmed  []string  `json:"confirmed,omitempty"`
	Dead       string    `json:"dead,omitempty"`    // why the oracle will not take it; its clips are signed over anew at the next visit
	Problem    string    `json:"problem,omitempty"` // the last passing trouble with it
}

type wifi struct {
	SSID     string    `json:"ssid"`
	Password string    `json:"password,omitempty"`
	At       time.Time `json:"at"`
}

type seen struct {
	Waiting int       `json:"waiting"`
	MB      float64   `json:"mb"`
	At      time.Time `json:"at"`
}

type state struct {
	Version int               `json:"version"`
	Node    string            `json:"node"`
	Device  string            `json:"device,omitempty"`
	WiFi    *wifi             `json:"wifi,omitempty"`
	Seen    *seen             `json:"seen,omitempty"` // what the node said at the last visit
	Clips   map[string]*clip  `json:"clips"`          // by detection ref, which is unique per node
	Batches map[string]*batch `json:"batches"`
}

type store struct {
	dir   string
	saved time.Time
	state
}

func openStore(dir, node string) (*store, error) {
	s := &store{dir: dir}
	b, err := os.ReadFile(filepath.Join(dir, stateFile))
	switch {
	case errors.Is(err, fs.ErrNotExist):
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(b, &s.state); err != nil {
			return nil, fmt.Errorf("%s cannot be read (%v); move it elsewhere to start this node afresh",
				filepath.Join(dir, stateFile), err)
		}
	}
	if s.Node == "" {
		s.Node = node
	}
	if s.Clips == nil {
		s.Clips = map[string]*clip{}
	}
	if s.Batches == nil {
		s.Batches = map[string]*batch{}
	}
	s.Version = 1
	return s, nil
}

// save writes the state to a new file beside the old one and renames it over it, so that a stop at any moment
// leaves the old state or the new one, never half of one. The file is readable by its owner only: it holds the
// node's WiFi password.
func (s *store) save() error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(&s.state, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(s.dir, ".state-*.tmp")
	if err != nil {
		return err
	}
	_, err = f.Write(append(b, '\n'))
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(f.Name(), filepath.Join(s.dir, stateFile))
	}
	if err != nil {
		os.Remove(f.Name())
		return fmt.Errorf("could not write %s: %w", filepath.Join(s.dir, stateFile), err)
	}
	s.saved = time.Now()
	return nil
}

func (s *store) abs(c *clip) string {
	return filepath.Join(s.dir, filepath.FromSlash(c.Path))
}

// signed reports whether a batch can still take its clips to the oracle, as far as this laptop knows.
func (s *store) signed(id string, now time.Time) bool {
	b := s.Batches[id]
	if b == nil || b.Dead != "" {
		return false
	}
	t, err := time.Parse(time.RFC3339, b.ExpiresAt)
	return err != nil || now.Before(t)
}

// open counts the clips of a batch that still wait for the oracle's confirmation.
func (s *store) open(b *batch) int {
	n := 0
	for _, it := range b.Items {
		if c := s.Clips[it.Ref]; !slices.Contains(b.Confirmed, it.Ref) && (c == nil || !c.Sent) {
			n++
		}
	}
	return n
}

var (
	monthRe   = regexp.MustCompile(`^\d{4}-\d{2}$`)
	unsafeRe  = regexp.MustCompile(`[^A-Za-z0-9._-]+`)
	sha256Hex = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// pathFor is where a clip is kept, relative to its node's folder: the month folder the node keeps it in (or the
// month of its detection) and the node's own file name, made safe for every file system. Two clips never share a
// path, also not on a file system that ignores case.
func (s *store) pathFor(ref string, c *clip, used map[string]string) string {
	file := strings.ReplaceAll(c.File, `\`, "/")
	month := path.Base(path.Dir(file))
	if !monthRe.MatchString(month) {
		month = "undated"
		if t := c.Facts["time_utc"]; len(t) >= 7 && monthRe.MatchString(t[:7]) {
			month = t[:7]
		}
	}
	name := safeName(path.Base(file))
	p := month + "/" + name
	if other, ok := used[strings.ToLower(p)]; ok && other != ref {
		ext := path.Ext(name)
		p = fmt.Sprintf("%s/%s-%d%s", month, strings.TrimSuffix(name, ext), c.Seq, ext)
	}
	return p
}

// safeName keeps a name from the node from reaching outside its folder or tripping a file system: only letters,
// digits, dot, dash and underscore, no leading or trailing dot, and none of the names Windows keeps for devices.
func safeName(s string) string {
	s = unsafeRe.ReplaceAllString(s, "_")
	if len(s) > 150 {
		s = s[len(s)-150:] // the end, which carries the extension
	}
	if s = strings.Trim(s, "."); s == "" {
		return "_"
	}
	base := strings.ToUpper(strings.SplitN(s, ".", 2)[0])
	switch {
	case base == "CON" || base == "PRN" || base == "AUX" || base == "NUL",
		len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '0' && base[3] <= '9':
		s = "_" + s
	}
	return s
}

func hashFile(p string) (string, int64, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	return hex.EncodeToString(h.Sum(nil)), n, err
}

func sha256hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// storeFor is the state of the node with this name, read from disk the first time. Call with a.mu held.
func (a *App) storeFor(node string) (*store, error) {
	key := safeName(node)
	if s := a.stores[key]; s != nil {
		return s, nil
	}
	s, err := openStore(filepath.Join(a.dir, key), node)
	if err != nil {
		return nil, err
	}
	a.stores[key] = s
	return s, nil
}

// allStoresLocked is the state of every node in the clips folder, each read from disk once. A state file that
// cannot be read is reported, once, and left alone. Call with a.mu held.
func (a *App) allStoresLocked() []*store {
	entries, err := os.ReadDir(a.dir)
	if err != nil && !errors.Is(err, fs.ErrNotExist) && !a.noted[a.dir] {
		a.noted[a.dir] = true
		a.noteLocked("error", "Cannot read the clips folder %s: %v.", a.dir, err)
	}
	for _, e := range entries {
		dir := filepath.Join(a.dir, e.Name())
		if !e.IsDir() || a.stores[e.Name()] != nil || a.noted[dir] {
			continue
		}
		if _, err := os.Stat(filepath.Join(dir, stateFile)); err != nil {
			continue
		}
		s, err := openStore(dir, e.Name())
		if err != nil {
			a.noted[dir] = true
			a.noteLocked("error", "%s", sentence(err))
			continue
		}
		a.stores[e.Name()] = s
	}
	out := make([]*store, 0, len(a.stores))
	for _, s := range a.stores {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Node < out[j].Node })
	return out
}

// rememberedPassword is the password last used with this WiFi name, if any.
func (a *App) rememberedPassword(ssid string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	pw, at := "", time.Time{}
	for _, s := range a.allStoresLocked() {
		if s.WiFi != nil && s.WiFi.SSID == ssid && s.WiFi.At.After(at) {
			pw, at = s.WiFi.Password, s.WiFi.At
		}
	}
	return pw
}

type failure struct {
	Ref string `json:"ref"`
	Why string `json:"why"`
}

type batchView struct {
	ID         string `json:"id"`
	N          int    `json:"n"`
	Confirmed  int    `json:"confirmed"`
	Registered bool   `json:"registered"`
	ExpiresAt  string `json:"expiresAt,omitempty"`
	Dead       string `json:"dead,omitempty"`
	Problem    string `json:"problem,omitempty"`
}

// summary counts one node's clips on this laptop, for the page and for life-clips status.
type summary struct {
	Node     string      `json:"node"`
	Device   string      `json:"device,omitempty"`
	OnNode   int         `json:"onNode"` // waiting on the node at the last visit
	SeenAt   *time.Time  `json:"seenAt,omitempty"`
	Verified int         `json:"verified"`         // downloaded and checked against their SHA-256
	Handed   int         `json:"handed"`           // signed over to this laptop
	Unsigned int         `json:"unsigned"`         // checked, but not signed over yet (that happens at a visit)
	ToSend   int         `json:"toSend"`           // signed over, not yet confirmed by the oracle
	SendBy   *time.Time  `json:"sendBy,omitempty"` // when the first signature on them runs out
	Sent     int         `json:"sent"`             // confirmed by the oracle
	Failed   []failure   `json:"failed"`
	Batches  []batchView `json:"batches"`
}

func (s *store) summary(now time.Time) summary {
	sum := summary{Node: s.Node, Device: s.Device, Failed: []failure{}, Batches: []batchView{}}
	if s.Seen != nil {
		at := s.Seen.At
		sum.OnNode, sum.SeenAt = s.Seen.Waiting, &at
	}
	for ref, c := range s.Clips {
		if c.Verified {
			sum.Verified++
		}
		switch {
		case c.Sent:
			sum.Sent++
			sum.Handed++
		case c.Batch != "" && s.signed(c.Batch, now):
			sum.Handed++
			sum.ToSend++
		case c.Verified && !c.Gone:
			sum.Unsigned++
		}
		if c.Failed != "" {
			sum.Failed = append(sum.Failed, failure{ref, c.Failed})
		}
	}
	sort.Slice(sum.Failed, func(i, j int) bool { return sum.Failed[i].Ref < sum.Failed[j].Ref })
	for id, b := range s.Batches {
		open := s.open(b)
		sum.Batches = append(sum.Batches, batchView{ID: id, N: len(b.Items), Confirmed: len(b.Items) - open,
			Registered: b.Registered, ExpiresAt: b.ExpiresAt, Dead: b.Dead, Problem: b.Problem})
		// past this the oracle refuses the batch and only another visit gets its clips across
		if t, err := time.Parse(time.RFC3339, b.ExpiresAt); err == nil && open > 0 && s.signed(id, now) &&
			(sum.SendBy == nil || t.Before(*sum.SendBy)) {
			sum.SendBy = &t
		}
	}
	sort.Slice(sum.Batches, func(i, j int) bool {
		return s.Batches[sum.Batches[i].ID].At.Before(s.Batches[sum.Batches[j].ID].At)
	})
	return sum
}
