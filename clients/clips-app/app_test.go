package main

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io/fs"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestFetchThenSend(t *testing.T) {
	clips := makeClips(5)
	r := newRig(t, clips)
	a := r.app()
	if err := a.fetch(context.Background()); err != nil {
		t.Fatalf("fetch: %v\n%s", err, messages(a))
	}
	for _, c := range clips {
		p := filepath.Join(r.dir, testNode, "2026-05", path.Base(c.file))
		if b, err := os.ReadFile(p); err != nil || !bytes.Equal(b, c.data) {
			t.Fatalf("%s is not the clip: %v", p, err)
		}
	}
	s := r.state()
	r.still(func() {
		if len(r.node.handed) != 1 || len(r.node.handed[0]) != 5 {
			t.Fatalf("handovers %v, want one of 5 clips", r.node.handed)
		}
		if calls := r.node.calls; calls[len(calls)-1] != "done" || r.node.done != 1 {
			t.Fatalf("the visit did not end with done, after the handover: %v", calls)
		}
		if len(s.Batches) != 1 {
			t.Fatalf("%d batches on disk, want 1", len(s.Batches))
		}
		for id, b := range s.Batches {
			if b.Grant != r.node.grants[id] || !reflect.DeepEqual(b.Items, r.node.items[id]) {
				t.Fatalf("batch %s on disk is not what the node signed", id)
			}
		}
	})
	for _, c := range clips {
		if sc := s.Clips[c.ref]; sc == nil || !sc.Verified || sc.Batch == "" || sc.SHA256 != sha256hex(c.data) {
			t.Fatalf("clip %s on disk: %+v", c.ref, sc)
		}
	}

	if err := a.send(context.Background()); err != nil {
		t.Fatalf("send: %v\n%s", err, messages(a))
	}
	s = r.state()
	var posts map[string]int
	r.still(func() {
		for _, c := range clips {
			if r.oracle.held[c.ref] != sha256hex(c.data) || !s.Clips[c.ref].Sent {
				t.Fatalf("clip %s did not arrive", c.ref)
			}
		}
		posts = maps.Clone(r.oracle.posts)
	})
	for _, c := range clips {
		if _, err := os.Stat(filepath.Join(r.dir, testNode, "2026-05", path.Base(c.file))); err != nil {
			t.Fatalf("the laptop must keep its copy: %v", err)
		}
	}
	for _, b := range s.Batches {
		if !b.Registered || len(b.Confirmed) != 5 {
			t.Fatalf("batch on disk after sending: %+v", b)
		}
	}
	if err := a.send(context.Background()); err != nil {
		t.Fatalf("second send: %v", err)
	}
	r.still(func() {
		if !maps.Equal(posts, r.oracle.posts) || !strings.Contains(messages(a), "Nothing is waiting to be sent") {
			t.Fatalf("a second send sent again")
		}
	})
}

// clipFiles are the clips in place in the node's folder, by file name.
func clipFiles(t *testing.T, dir string) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	err := filepath.WalkDir(filepath.Join(dir, testNode), func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		switch name := d.Name(); {
		case strings.HasSuffix(name, ".part"):
			t.Errorf("a part file was left behind: %s", p)
		case strings.HasSuffix(name, ".m4a"):
			out[name] = true
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestResumeAfterStopMidDownload(t *testing.T) {
	clips := makeClips(40)
	r := newRig(t, clips)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r.still(func() {
		r.node.onServe = func(n int) {
			if n == 15 {
				cancel()
			}
		}
	})
	if err := r.app().fetch(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("fetch: %v, want it stopped", err)
	}
	// A hard stop may leave no state at all: what counts is the checked files in place.
	os.Remove(filepath.Join(r.dir, testNode, stateFile))
	have := clipFiles(t, r.dir)
	if len(have) == 0 || len(have) >= len(clips) {
		t.Fatalf("%d clips in place after the stop", len(have))
	}
	var before map[string]int
	r.still(func() {
		r.node.onServe = nil
		before = maps.Clone(r.node.gets)
	})

	a := r.app()
	if err := a.fetch(context.Background()); err != nil {
		t.Fatalf("fetch after the restart: %v\n%s", err, messages(a))
	}
	r.still(func() {
		n := 0
		for _, c := range clips {
			again := r.node.gets[c.file] - before[c.file]
			n += again
			if have[path.Base(c.file)] && again != 0 {
				t.Fatalf("%s was downloaded again", c.file)
			}
		}
		if n != len(clips)-len(have) {
			t.Fatalf("the restarted app downloaded %d clips, want %d", n, len(clips)-len(have))
		}
		if len(r.node.handed) != 1 || len(r.node.handed[0]) != len(clips) {
			t.Fatalf("want all %d clips in one handover: %v", len(clips), r.node.handed)
		}
	})
	if got := clipFiles(t, r.dir); len(got) != len(clips) {
		t.Fatalf("%d clips in place, want %d", len(got), len(clips))
	}
	if s := r.state(); len(s.Batches) != 1 {
		t.Fatalf("%d batches on disk, want 1", len(s.Batches))
	}
}

func TestCorruptDownloadIsRetriedThenFailed(t *testing.T) {
	clips := makeClips(4)
	r := newRig(t, clips)
	r.still(func() {
		r.node.corrupt[clips[0].file] = -1 // damaged every time
		r.node.corrupt[clips[1].file] = 1  // damaged once
	})
	a := r.app()
	if err := a.fetch(context.Background()); !errors.Is(err, errPartly) {
		t.Fatalf("fetch: %v, want errPartly", err)
	}
	s := r.state()
	r.still(func() {
		if g := r.node.gets; g[clips[0].file] != 2 || g[clips[1].file] != 2 || g[clips[2].file] != 1 {
			t.Fatalf("downloads per file: %v", g)
		}
		if got := r.node.handed[0]; len(got) != 3 || slices.Contains(got, clips[0].ref) {
			t.Fatalf("handed over %v, want the three good clips", got)
		}
		if r.node.done != 1 {
			t.Fatalf("a failed clip stays on the node; the visit still ends")
		}
	})
	if c := s.Clips[clips[0].ref]; c.Verified || !strings.Contains(c.Failed, "SHA-256") {
		t.Fatalf("the damaged clip: %+v", c)
	}
	if c := s.Clips[clips[1].ref]; !c.Verified || c.Failed != "" {
		t.Fatalf("the clip damaged once: %+v", c)
	}
	if have := clipFiles(t, r.dir); have[path.Base(clips[0].file)] || len(have) != 3 {
		t.Fatalf("clips in place: %v", have)
	}
	if sum := summaryOf(a); len(sum.Failed) != 1 || sum.Failed[0].Ref != clips[0].ref {
		t.Fatalf("failures shown: %+v", sum.Failed)
	}
}

func TestPaginationAndHandoverChunks(t *testing.T) {
	clips := makeClips(4500)
	r := newRig(t, clips)
	a := r.app()
	if err := a.fetch(context.Background()); err != nil {
		t.Fatalf("fetch: %v\n%s", err, messages(a))
	}
	r.still(func() {
		if want := []string{"0", "1000", "2000", "3000", "4000"}; !slices.Equal(r.node.afters, want) {
			t.Fatalf("pages asked after %v, want %v", r.node.afters, want)
		}
		for _, l := range r.node.limits {
			if l != "1000" {
				t.Fatalf("page sizes asked %v", r.node.limits)
			}
		}
		var sizes []int
		seen := map[string]bool{}
		for _, h := range r.node.handed {
			sizes = append(sizes, len(h))
			for _, ref := range h {
				if seen[ref] {
					t.Fatalf("%s handed over twice", ref)
				}
				seen[ref] = true
			}
		}
		if !slices.Equal(sizes, []int{2000, 2000, 500}) || len(seen) != len(clips) {
			t.Fatalf("handover sizes %v", sizes)
		}
	})
	if s := r.state(); len(s.Batches) != 3 {
		t.Fatalf("%d batches on disk, want 3", len(s.Batches))
	}
}

func TestHandoverErrorIsShownAndNoBatchKept(t *testing.T) {
	clips := makeClips(3)
	r := newRig(t, clips)
	r.still(func() { r.node.device = "" })
	a := r.app()
	if err := a.fetch(context.Background()); !errors.Is(err, errPartly) {
		t.Fatalf("fetch: %v, want errPartly", err)
	}
	msgs := messages(a)
	if !strings.Contains(msgs, "the node does not know its own id yet") {
		t.Fatalf("the node's reason was not shown:\n%s", msgs)
	}
	if !strings.Contains(msgs, "does not know its id on the oracle yet") {
		t.Fatalf("no early warning from hello:\n%s", msgs)
	}
	s := r.state()
	if len(s.Batches) != 0 {
		t.Fatalf("a batch was kept: %v", s.Batches)
	}
	for _, c := range clips {
		if sc := s.Clips[c.ref]; !sc.Verified || sc.Batch != "" {
			t.Fatalf("clip %s: %+v", c.ref, sc)
		}
	}
	r.still(func() {
		if r.node.done != 0 {
			t.Fatalf("the visit was ended, so the handover cannot be tried again")
		}
	})
	if sum := summaryOf(a); sum.Unsigned != 3 || sum.Handed != 0 {
		t.Fatalf("summary %+v", sum)
	}
}

func TestHaveRefsAreNotSentAgain(t *testing.T) {
	clips := makeClips(4)
	r := newRig(t, clips)
	a := r.app()
	if err := a.fetch(context.Background()); err != nil {
		t.Fatal(err)
	}
	r.still(func() {
		r.oracle.held[clips[0].ref] = sha256hex(clips[0].data)
		r.oracle.held[clips[1].ref] = sha256hex(clips[1].data)
	})
	if err := a.send(context.Background()); err != nil {
		t.Fatalf("send: %v\n%s", err, messages(a))
	}
	r.still(func() {
		p := r.oracle.posts
		if p[clips[0].ref] != 0 || p[clips[1].ref] != 0 || p[clips[2].ref] != 1 || p[clips[3].ref] != 1 {
			t.Fatalf("posts %v, want none for the clips the oracle has", p)
		}
	})
	if sum := summaryOf(a); sum.Sent != 4 || sum.ToSend != 0 {
		t.Fatalf("summary %+v", sum)
	}
}

func TestDifferentSoundAtTheOracleIsReplaced(t *testing.T) {
	clips := makeClips(2)
	r := newRig(t, clips)
	a := r.app()
	if err := a.fetch(context.Background()); err != nil {
		t.Fatal(err)
	}
	r.still(func() {
		r.oracle.held[clips[0].ref] = strings.Repeat("0", 64) // another sound
		r.oracle.held[clips[1].ref] = ""                      // a row whose sound is gone
	})
	if err := a.send(context.Background()); err != nil {
		t.Fatalf("send: %v\n%s", err, messages(a))
	}
	r.still(func() {
		for _, c := range clips {
			forms := r.oracle.forms[c.ref]
			if len(forms) != 2 || first(forms[0].values["replace"]) != "" || first(forms[1].values["replace"]) != "1" {
				t.Fatalf("%s: want a send, then the same with replace=1", c.ref)
			}
			if !bytes.Equal(forms[0].data, forms[1].data) || r.oracle.held[c.ref] != sha256hex(c.data) {
				t.Fatalf("%s was not replaced with the same clip", c.ref)
			}
		}
	})
	if sum := summaryOf(a); sum.Sent != 2 {
		t.Fatalf("summary %+v", sum)
	}
}

func TestSameSoundAtTheOracleCountsAsDelivered(t *testing.T) {
	clips := makeClips(2)
	r := newRig(t, clips)
	a := r.app()
	if err := a.fetch(context.Background()); err != nil {
		t.Fatal(err)
	}
	r.still(func() {
		r.oracle.noHave = true
		r.oracle.held[clips[0].ref] = sha256hex(clips[0].data)
	})
	if err := a.send(context.Background()); err != nil {
		t.Fatalf("send: %v\n%s", err, messages(a))
	}
	r.still(func() {
		if forms := r.oracle.forms[clips[0].ref]; len(forms) != 1 || first(forms[0].values["replace"]) != "" {
			t.Fatalf("want one send without replace, got %d", len(forms))
		}
	})
	if s := r.state(); !s.Clips[clips[0].ref].Sent || !s.Clips[clips[1].ref].Sent {
		t.Fatalf("not delivered")
	}
}

func TestRefusedBatchStopsWithReasonAndKeepsClips(t *testing.T) {
	clips := makeClips(4)
	r := newRig(t, clips)
	a := r.app()
	a.chunk = 2
	if err := a.fetch(context.Background()); err != nil {
		t.Fatal(err)
	}
	why := "the grant has run out: take the clips from the node again"
	var dead string
	var deadItems, liveItems []item
	r.still(func() {
		dead = r.node.batches[0]
		deadItems, liveItems = r.node.items[dead], r.node.items[r.node.batches[1]]
		r.oracle.refuse[dead] = why
	})
	if err := a.send(context.Background()); !errors.Is(err, errPartly) {
		t.Fatalf("send: %v, want errPartly", err)
	}
	if msgs := messages(a); !strings.Contains(msgs, why) || !strings.Contains(msgs, dead) {
		t.Fatalf("the refusal was not shown clearly:\n%s", msgs)
	}
	s := r.state()
	if !strings.Contains(s.Batches[dead].Dead, why) {
		t.Fatalf("batch %s on disk: %+v", dead, s.Batches[dead])
	}
	r.still(func() {
		for _, it := range deadItems {
			if c := s.Clips[it.Ref]; c.Sent || !c.Verified || r.oracle.posts[it.Ref] != 0 {
				t.Fatalf("clip %s of the refused batch: %+v", it.Ref, c)
			}
		}
	})
	for _, it := range deadItems {
		if _, err := os.Stat(filepath.Join(r.dir, testNode, filepath.FromSlash(s.Clips[it.Ref].Path))); err != nil {
			t.Fatalf("the clip must stay on the laptop: %v", err)
		}
	}
	for _, it := range liveItems {
		if !s.Clips[it.Ref].Sent {
			t.Fatalf("the other batch was not sent")
		}
	}

	// At the next visit the node signs the refused batch's clips over again, without a download.
	var gets map[string]int
	r.still(func() { gets = maps.Clone(r.node.gets) })
	if err := a.fetch(context.Background()); err != nil {
		t.Fatal(err)
	}
	r.still(func() {
		if !maps.Equal(gets, r.node.gets) {
			t.Fatalf("clips were downloaded again")
		}
		again := r.node.handed[len(r.node.handed)-1]
		if want := []string{deadItems[0].Ref, deadItems[1].Ref}; !slices.Equal(slices.Sorted(slices.Values(again)), want) {
			t.Fatalf("handed over again %v, want %v", again, want)
		}
	})
	if err := a.send(context.Background()); err != nil {
		t.Fatalf("send after the new handover: %v\n%s", err, messages(a))
	}
	if sum := summaryOf(a); sum.Sent != 4 {
		t.Fatalf("summary %+v", sum)
	}
}

func TestServerErrorsAreRetried(t *testing.T) {
	clips := makeClips(2)
	r := newRig(t, clips)
	a := r.app()
	if err := a.fetch(context.Background()); err != nil {
		t.Fatal(err)
	}
	r.still(func() {
		r.oracle.failReg = 1
		r.oracle.fail[clips[0].ref] = 2
	})
	if err := a.send(context.Background()); err != nil {
		t.Fatalf("send: %v\n%s", err, messages(a))
	}
	r.still(func() {
		if r.oracle.posts[clips[0].ref] != 3 || len(r.oracle.regs) != 1 {
			t.Fatalf("posts %v, registrations %d", r.oracle.posts, len(r.oracle.regs))
		}
	})
	if sum := summaryOf(a); sum.Sent != 2 {
		t.Fatalf("summary %+v", sum)
	}

	// An oracle that keeps failing is out of reach: the run stops, and the clips wait for the next one.
	r2 := newRig(t, clips)
	b := r2.app()
	if err := b.fetch(context.Background()); err != nil {
		t.Fatal(err)
	}
	r2.still(func() { r2.oracle.fail[clips[0].ref] = 100 })
	if err := b.send(context.Background()); !errors.Is(err, errPartly) {
		t.Fatalf("send: %v, want errPartly", err)
	}
	r2.still(func() {
		if r2.oracle.posts[clips[0].ref] != b.tries || r2.oracle.posts[clips[1].ref] != 0 {
			t.Fatalf("posts %v", r2.oracle.posts)
		}
	})
	if c := r2.state().Clips[clips[0].ref]; c.Sent || c.Failed != "" {
		t.Fatalf("a clip the oracle cannot take for now is not a failure: %+v", c)
	}
	if !strings.Contains(messages(b), "send again when this laptop is online") {
		t.Fatalf("not told:\n%s", messages(b))
	}
}

func TestUnprocessableClipIsReadAgainOnce(t *testing.T) {
	clips := makeClips(2)
	r := newRig(t, clips)
	a := r.app()
	if err := a.fetch(context.Background()); err != nil {
		t.Fatal(err)
	}
	r.still(func() {
		r.oracle.bad[clips[0].ref] = 1
		r.oracle.bad[clips[1].ref] = 5
	})
	if err := a.send(context.Background()); !errors.Is(err, errPartly) {
		t.Fatalf("send: %v, want errPartly", err)
	}
	s := r.state()
	r.still(func() {
		if r.oracle.posts[clips[0].ref] != 2 || !s.Clips[clips[0].ref].Sent {
			t.Fatalf("one 422, then taken: posts %v", r.oracle.posts)
		}
		if c := s.Clips[clips[1].ref]; r.oracle.posts[clips[1].ref] != 2 || c.Sent || !strings.Contains(c.Failed, "SHA-256") {
			t.Fatalf("two 422s mark the clip failed: %+v", c)
		}
	})
}

func TestClipThatLeftTheNodeIsSkipped(t *testing.T) {
	clips := makeClips(3)
	r := newRig(t, clips)
	r.still(func() { r.node.missing[clips[1].file] = true })
	a := r.app()
	if err := a.fetch(context.Background()); err != nil {
		t.Fatalf("fetch: %v\n%s", err, messages(a))
	}
	r.still(func() {
		if got := r.node.handed[0]; len(got) != 2 || slices.Contains(got, clips[1].ref) {
			t.Fatalf("handed over %v", got)
		}
	})
	if s := r.state(); s.Clips[clips[1].ref] != nil {
		t.Fatalf("the clip that left the node is still listed")
	}
	if sum := summaryOf(a); len(sum.Failed) != 0 {
		t.Fatalf("a clip that left the node is not a failure: %+v", sum.Failed)
	}
	if !strings.Contains(messages(a), "1 had already left the node") {
		t.Fatalf("not reported:\n%s", messages(a))
	}
}

func TestEndOfVisitStopsDownloads(t *testing.T) {
	r := newRig(t, makeClips(3))
	r.still(func() { r.node.until = time.Now().Add(30 * time.Second).Unix() })
	a := r.app()
	if err := a.fetch(context.Background()); err != nil {
		t.Fatalf("fetch: %v", err)
	}
	r.still(func() {
		if len(r.node.gets) != 0 {
			t.Fatalf("downloads started with half a minute left: %v", r.node.gets)
		}
		if !strings.Contains(messages(a), "visit ends in under") || r.node.done != 1 {
			t.Fatalf("not told, or the visit not ended:\n%s", messages(a))
		}
	})
}

func TestStateSurvivesARestart(t *testing.T) {
	r := newRig(t, makeClips(6))
	a := r.app()
	a.chunk = 4
	if err := a.fetch(context.Background()); err != nil {
		t.Fatal(err)
	}
	before, after := summaryOf(a), summaryOf(r.app())
	if after.Verified != 6 || after.Handed != 6 || after.ToSend != 6 || !reflect.DeepEqual(before.Batches, after.Batches) ||
		len(after.Batches) != 2 || after.SeenAt == nil || !after.SeenAt.Equal(*before.SeenAt) {
		t.Fatalf("after a restart\n%+v\nwant\n%+v", after, before)
	}
	r.still(func() {
		for id, bt := range r.state().Batches {
			if bt.Grant != r.node.grants[id] {
				t.Fatalf("grant of %s lost", id)
			}
		}
	})
	b := r.app()
	if err := b.send(context.Background()); err != nil {
		t.Fatalf("send from the restarted app: %v\n%s", err, messages(b))
	}
	if sum := summaryOf(r.app()); sum.Sent != 6 || sum.ToSend != 0 {
		t.Fatalf("after sending and another restart: %+v", sum)
	}
}

func TestRequestsAreAsSpecified(t *testing.T) {
	clips := makeClips(1)
	r := newRig(t, clips)
	a := r.app()
	if err := a.fetch(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := a.send(context.Background()); err != nil {
		t.Fatalf("send: %v\n%s", err, messages(a))
	}
	r.still(func() {
		id := r.node.batches[0]
		if r.node.laptops[0] != "field-laptop" {
			t.Fatalf("handover laptop %q", r.node.laptops[0])
		}
		for _, h := range r.oracle.auths {
			if h != "Grant "+r.node.grants[id] {
				t.Fatalf("Authorization %q, want the node's grant", h)
			}
		}
		reg := r.oracle.regs[0]
		if keys := slices.Sorted(maps.Keys(reg)); !slices.Equal(keys, []string{"items", "laptop"}) {
			t.Fatalf("batch registration fields %v", keys)
		}
		var items []item
		var laptop string
		json.Unmarshal(reg["items"], &items)
		json.Unmarshal(reg["laptop"], &laptop)
		if !reflect.DeepEqual(items, r.node.items[id]) || laptop != "field-laptop" {
			t.Fatalf("registered %v from %q", items, laptop)
		}
		f := r.oracle.forms[clips[0].ref][0]
		want := []string{"band", "clip_s", "detection", "detection_from_s", "detection_to_s", "detector", "gain_db",
			"scientific", "score", "sha256", "source", "time_utc"} // expansion is null on the node, so it is left out
		if keys := slices.Sorted(maps.Keys(f.values)); !slices.Equal(keys, want) {
			t.Fatalf("form fields %v\nwant %v", keys, want)
		}
		for k, v := range map[string]string{"detection": clips[0].ref, "time_utc": "2026-05-14T03:12:09+00:00",
			"scientific": "Limosa limosa", "score": "0.812", "band": "0.8", "detector": "birdnet-go", "source": "AudioMoth",
			"clip_s": "7.0", "detection_from_s": "0.0", "detection_to_s": "3.0", "gain_db": "11.5", "sha256": sha256hex(clips[0].data)} {
			if got := f.values[k]; len(got) != 1 || got[0] != v {
				t.Fatalf("field %s = %q, want %q", k, got, v)
			}
		}
		if !slices.Equal(f.files, []string{"file"}) || f.name != path.Base(clips[0].file) || f.ctype != "audio/mp4" ||
			!bytes.Equal(f.data, clips[0].data) {
			t.Fatalf("file part %v %q %q", f.files, f.name, f.ctype)
		}
	})
}

func TestPage(t *testing.T) {
	r := newRig(t, makeClips(2))
	a := r.app()
	a.mu.Lock()
	s, _ := a.storeFor(testNode)
	s.WiFi = &wifi{SSID: testNode, Password: "vzp6-6dhy-vxug", At: time.Now()}
	if err := s.save(); err != nil {
		t.Fatal(err)
	}
	a.mu.Unlock()
	h := a.uiHandler("127.0.0.1:5000", "k3y", func() {})
	do := func(method, url, key, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, url, strings.NewReader(body))
		if key != "" {
			req.Header.Set("X-Token", key)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	status := func() statusView {
		var st statusView
		if err := json.Unmarshal(do("GET", "http://127.0.0.1:5000/api/status", "k3y", "").Body.Bytes(), &st); err != nil {
			t.Fatal(err)
		}
		return st
	}
	wait := func() {
		for i := 0; a.busy(); i++ {
			if i > 1000 {
				t.Fatalf("the job does not end")
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	if rec := do("GET", "http://127.0.0.1:5000/", "", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), "<title>Life Clips</title>") ||
		rec.Header().Get("Content-Security-Policy") == "" {
		t.Fatalf("page: %d", rec.Code)
	}
	if rec := do("GET", "http://127.0.0.1:5000/api/status", "", ""); rec.Code != http.StatusForbidden {
		t.Fatalf("status without the key: %d", rec.Code)
	}
	if rec := do("GET", "http://elsewhere.example:5000/api/status", "k3y", ""); rec.Code != http.StatusForbidden {
		t.Fatalf("status for another host: %d", rec.Code)
	}
	rec := do("GET", "http://localhost:5000/api/status", "k3y", "")
	var st statusView
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &st) != nil || st.Version != version || !slices.Equal(st.SSIDs, []string{testNode}) {
		t.Fatalf("status: %d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "vzp6-6dhy-vxug") {
		t.Fatalf("the status shows the WiFi password")
	}
	if !strings.Contains(rec.Body.String(), `"messages":[]`) { // the page reads it as a list from the first poll on
		t.Fatalf("a fresh status has no list of messages: %s", rec.Body)
	}
	if rec := do("POST", "http://127.0.0.1:5000/api/connect", "k3y", `{"ssid":"life-x7k2qp","password":"short"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("a password of 5 characters: %d", rec.Code)
	}

	// Connect with the remembered password: the test cannot join a WiFi, and the node answers anyway.
	if rec := do("POST", "http://127.0.0.1:5000/api/connect", "k3y", `{"ssid":"life-x7k2qp","password":""}`); rec.Code != http.StatusAccepted {
		t.Fatalf("connect: %d %s", rec.Code, rec.Body)
	}
	wait()
	if st := status(); st.Node == nil || st.Node.Name != testNode || st.Node.Waiting != 2 || st.Node.SecondsLeft == nil || *st.Node.SecondsLeft < 1400 {
		t.Fatalf("not connected: %+v\n%s", st.Node, messages(a))
	}
	if rec := do("POST", "http://127.0.0.1:5000/api/fetch", "k3y", "{}"); rec.Code != http.StatusAccepted {
		t.Fatalf("fetch: %d", rec.Code)
	}
	wait()
	if rec := do("POST", "http://127.0.0.1:5000/api/send", "k3y", "{}"); rec.Code != http.StatusAccepted {
		t.Fatalf("send: %d", rec.Code)
	}
	wait()
	if st := status(); len(st.Nodes) != 1 || st.Nodes[0].Sent != 2 || st.Node != nil || st.Run.Kind != "send" || st.Run.Sent != 2 {
		t.Fatalf("after download and send: %+v %+v\n%s", st.Nodes, st.Run, messages(a))
	}
}

func TestWLANProfile(t *testing.T) {
	var p struct {
		Name string `xml:"name"`
		SSID struct {
			Hex  string `xml:"hex"`
			Name string `xml:"name"`
		} `xml:"SSIDConfig>SSID"`
		Auth string `xml:"MSM>security>authEncryption>authentication"`
		Enc  string `xml:"MSM>security>authEncryption>encryption"`
		Type string `xml:"MSM>security>sharedKey>keyType"`
		Key  string `xml:"MSM>security>sharedKey>keyMaterial"`
	}
	pw := `a<b&c"d'e>f`
	if err := xml.Unmarshal(wlanProfile(testNode, pw), &p); err != nil {
		t.Fatal(err)
	}
	if p.Name != testNode || p.SSID.Name != testNode || p.SSID.Hex != "6C6966652D78376B327170" ||
		p.Auth != "WPA2PSK" || p.Enc != "AES" || p.Type != "passPhrase" || p.Key != pw {
		t.Fatalf("profile %+v", p)
	}
}

func TestWiFiHelpers(t *testing.T) {
	out := "\nHardware Port: Ethernet\nDevice: en0\nEthernet Address: a0:ce:c8:00:00:01\n\n" +
		"Hardware Port: Wi-Fi\nDevice: en1\nEthernet Address: a0:ce:c8:00:00:02\n"
	if d := wifiDevice(out); d != "en1" {
		t.Fatalf("Wi-Fi device %q", d)
	}
	if wifiDevice("Hardware Port: Ethernet\nDevice: en0\n") != "" {
		t.Fatalf("found a Wi-Fi device where there is none")
	}
	if !joinFailed("Could not find network life-x7k2qp.") || !joinFailed("Failed to join network life-x7k2qp.\nError: -3900") || joinFailed("") {
		t.Fatalf("networksetup output misread")
	}
	for _, bad := range [][2]string{{"", "vzp6-6dhy-vxug"}, {testNode, ""}, {testNode, "short"}, {testNode, strings.Repeat("x", 64)},
		{testNode, "wachtwoordé"}, {"life\nx", "vzp6-6dhy-vxug"}} {
		if validWiFi(bad[0], bad[1]) == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
	if err := validWiFi(testNode, "vzp6-6dhy-vxug"); err != nil {
		t.Fatal(err)
	}
}

func TestLocalPaths(t *testing.T) {
	s := &store{}
	used := map[string]string{}
	c := &clip{File: "../../../etc/passwd", Facts: map[string]string{"time_utc": "2026-05-14T03:12:09+00:00"}, Seq: 3}
	if p := s.pathFor("1@1", c, used); p != "2026-05/passwd" {
		t.Fatalf("a path out of the folder became %q", p)
	}
	used["2026-05/passwd"] = "1@1"
	if p := s.pathFor("2@1", c, used); p != "2026-05/passwd-3" {
		t.Fatalf("two clips share %q", p)
	}
	for in, want := range map[string]string{
		"clips/2026-05/CON.m4a":        "2026-05/_CON.m4a",
		`clips\2026-06\a:b?.m4a`:       "2026-06/a_b_.m4a",
		"clips/odd/.hidden.m4a":        "2026-05/hidden.m4a",
		"clips/2026-05/x/../../..":     "2026-05/_",
		"20260514-051209_limosa_1.m4a": "2026-05/20260514-051209_limosa_1.m4a",
	} {
		c := &clip{File: in, Facts: map[string]string{"time_utc": "2026-05-14T03:12:09+00:00"}}
		if p := s.pathFor("r", c, map[string]string{}); p != want {
			t.Fatalf("%q became %q, want %q", in, p, want)
		}
	}
}

func TestCommandLine(t *testing.T) {
	r := newRig(t, makeClips(3))
	var out, errb bytes.Buffer
	start := time.Now()
	if code := run([]string{"fetch", "--dir", r.dir, "--node", r.nodeURL}, &out, &errb); code != 0 {
		t.Fatalf("fetch exited %d\n%s%s", code, out.String(), errb.String())
	}
	out.Reset()
	code, due := run([]string{"status", "--dir", r.dir}, &out, &errb), false
	for _, at := range []time.Time{start, time.Now()} { // the fake node's grant runs 90 days, even across midnight
		due = due || strings.Contains(out.String(), "waiting to be sent:         3\n  send them before:           "+
			at.Add(90*24*time.Hour).Format("2 Jan 2006"))
	}
	if code != 0 || !due {
		t.Fatalf("status before sending exited %d\n%s", code, out.String())
	}
	if code := run([]string{"send", "--dir", r.dir, "--oracle", r.oracleURL}, &out, &errb); code != 0 {
		t.Fatalf("send exited %d\n%s%s", code, out.String(), errb.String())
	}
	out.Reset()
	if code := run([]string{"status", "--dir", r.dir}, &out, &errb); code != 0 || !strings.Contains(out.String(), "sent and confirmed:         3") ||
		strings.Contains(out.String(), "send them before") {
		t.Fatalf("status exited %d\n%s", code, out.String())
	}
	if code := run([]string{"nonsense"}, &out, &errb); code != 2 {
		t.Fatalf("an unknown command exited %d", code)
	}
	if code := run([]string{"send", "--ssid", "x"}, &out, &errb); code != 2 {
		t.Fatalf("a flag of another command exited %d", code)
	}
	out.Reset()
	if code := run([]string{"version"}, &out, &errb); code != 0 || !strings.Contains(out.String(), version) {
		t.Fatalf("version: %d %q", code, out.String())
	}
}
