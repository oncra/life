// Command life-clips takes the sound clips off a Life Node at a visit, over the node's own WiFi, and later sends
// them to the Life Oracle with the grant the node signed for them. See README.md.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"
)

// version is set when a release is built: -ldflags "-X main.version=clips-app-v1.0.0".
var version = "dev"

const defaultOracle = "https://life.oncra.org/api/v1"

// nodeAddrs are where a node's clip server answers on its own WiFi: its address on the network it hands out, and a
// link-local one for a laptop that got no address from it.
var nodeAddrs = []string{"http://10.42.0.1", "http://169.254.42.1"}

// errPartly ends a run in which something did not go through; what, and why, has been said already.
var errPartly = errors.New("not everything went through")

const usage = `life-clips takes the sound clips off a Life Node at a visit and sends them to the Life Oracle.

  life-clips [ui] [--no-browser]       open the app in the browser (the default)
  life-clips fetch [--node URL] [--ssid NAME --password PASSWORD]
                                       join the node's WiFi, download and check every waiting clip, have the
                                       node sign them over to this laptop, and end the visit
  life-clips send [--oracle URL]       send the clips to the oracle, any time this laptop is online
  life-clips status                    what is on this laptop, per node
  life-clips version

Every command takes --dir DIR (or LIFE_CLIPS_DIR): the folder the clips are kept in, by default "Life Clips" in
your home folder. --node (LIFE_CLIPS_NODE) and --oracle (LIFE_CLIPS_ORACLE) point elsewhere, for tests. The WiFi
password can also come from LIFE_CLIPS_WIFI_PASSWORD, which keeps it out of the list of running processes.
`

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	cmd := "ui"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "version":
		fmt.Fprintln(stdout, "life-clips", version)
		return 0
	case "help":
		fmt.Fprint(stdout, usage)
		return 0
	case "ui", "fetch", "send", "status":
	default:
		fmt.Fprintf(stderr, "life-clips: there is no command %q\n\n%s", cmd, usage)
		return 2
	}
	fs := flag.NewFlagSet("life-clips "+cmd, flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() { fmt.Fprint(stderr, usage) }
	dir := fs.String("dir", os.Getenv("LIFE_CLIPS_DIR"), "")
	var node, oracle, ssid, password string
	var noBrowser bool
	if cmd == "ui" || cmd == "fetch" {
		fs.StringVar(&node, "node", os.Getenv("LIFE_CLIPS_NODE"), "")
	}
	if cmd == "ui" || cmd == "send" {
		fs.StringVar(&oracle, "oracle", os.Getenv("LIFE_CLIPS_ORACLE"), "")
	}
	if cmd == "fetch" {
		fs.StringVar(&ssid, "ssid", "", "")
		// no default from the environment here: flag would print it in the usage text
		fs.StringVar(&password, "password", "", "")
	}
	if cmd == "ui" {
		fs.BoolVar(&noBrowser, "no-browser", false, "")
	}
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if fs.NArg() > 0 {
		fmt.Fprintf(stderr, "life-clips: unexpected %q\n\n%s", fs.Arg(0), usage)
		return 2
	}
	a, err := newApp(*dir, node, oracle)
	if err != nil {
		fmt.Fprintln(stderr, "life-clips:", err)
		return 1
	}
	a.out = stdout
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	switch cmd {
	case "status":
		err = a.printStatus(stdout)
	case "fetch":
		if ssid != "" {
			if password == "" {
				password = os.Getenv("LIFE_CLIPS_WIFI_PASSWORD")
			}
			if password == "" {
				password = a.rememberedPassword(ssid)
			}
			err = a.connect(ctx, ssid, password)
		}
		if err == nil {
			err = a.fetch(ctx)
		}
	case "send":
		err = a.send(ctx)
	case "ui":
		err = a.serveUI(ctx, !noBrowser)
	}
	switch {
	case err == nil:
		return 0
	case errors.Is(err, context.Canceled):
		fmt.Fprintln(stderr, "Stopped. Everything done so far is kept; run it again to carry on.")
	case errors.Is(err, errPartly):
		fmt.Fprintln(stderr, "Not everything went through; the reasons are above, and in life-clips status.")
	default:
		fmt.Fprintln(stderr, sentence(err))
	}
	return 1
}

// App holds what the commands and the page share: where things are, how to reach the node and the oracle, the
// state of every node met so far, and the progress of the job that runs.
type App struct {
	dir     string
	nodeURL string // a fixed address for the node; empty to look at nodeAddrs
	oracle  string
	laptop  string
	out     io.Writer // where the command line shows what happens; nil for nowhere

	nodeHTTP   *http.Client
	oracleHTTP *http.Client
	join       func(ctx context.Context, ssid, password string) error
	pause      time.Duration // the first wait before a retry; each next one is twice as long
	tries      int           // attempts at the oracle before it counts as out of reach
	reserve    time.Duration // downloading stops this long before the visit ends, so the node can still sign
	workers    int           // downloads at once
	chunk      int           // clips per handover; the node signs at most 2000 at once
	findFor    time.Duration // how long to wait for the node to answer after joining its WiFi

	mu     sync.Mutex // guards everything below, and the state in every store
	stores map[string]*store
	noted  map[string]bool
	p      progress
	cancel context.CancelFunc
}

func newApp(dir, node, oracle string) (*App, error) {
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("there is no home folder to keep the clips in (%v); name a folder with --dir", err)
		}
		dir = filepath.Join(home, "Life Clips")
	}
	if oracle == "" {
		oracle = defaultOracle
	}
	// The node is on the WiFi right beside the laptop: never through a proxy, and an address that does not answer
	// within seconds is not the node. The node's server drops a connection that sat idle for 30 s; dropping ours
	// sooner means a handover never goes out on one it is just closing.
	nodeTransport := &http.Transport{
		DialContext:           (&net.Dialer{Timeout: 4 * time.Second}).DialContext,
		ResponseHeaderTimeout: 30 * time.Second,
		MaxIdleConnsPerHost:   8,
		IdleConnTimeout:       20 * time.Second,
	}
	return &App{
		dir:        dir,
		nodeURL:    strings.TrimRight(node, "/"),
		oracle:     strings.TrimRight(oracle, "/"),
		laptop:     computerName(),
		nodeHTTP:   &http.Client{Transport: nodeTransport},
		oracleHTTP: &http.Client{Timeout: 2 * time.Minute},
		join:       joinWiFi,
		pause:      time.Second,
		tries:      5,
		reserve:    time.Minute,
		workers:    3,
		chunk:      2000,
		findFor:    time.Minute,
		stores:     map[string]*store{},
		noted:      map[string]bool{},
	}, nil
}

type message struct {
	At   time.Time `json:"at"`
	Kind string    `json:"kind"` // info, warn or error
	Text string    `json:"text"`
}

// progress is what the page shows: the job that runs, the node this laptop is connected to, and what happened.
type progress struct {
	Job      string
	Doing    string
	Node     *nodeConn // nil when not connected to a node
	Hello    hello
	Ends     time.Time // when the visit ends, on this laptop's clock; zero when the node did not say
	Run      runView
	Messages []message
}

// runView counts the last download or send.
type runView struct {
	Kind    string `json:"kind"`    // fetch or send
	Total   int    `json:"total"`   // clips to download
	Got     int    `json:"got"`     // downloaded and checked
	Failed  int    `json:"failed"`  // did not match their SHA-256, twice
	Gone    int    `json:"gone"`    // left the node another way before their turn
	Handed  int    `json:"handed"`  // signed over to this laptop
	ToSend  int    `json:"toSend"`  // clips to send
	Sent    int    `json:"sent"`    // confirmed by the oracle
	NotSent int    `json:"notSent"` // the oracle did not take them
}

// say records a message for the page and prints it on the command line.
func (a *App) say(kind, format string, args ...any) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.noteLocked(kind, format, args...)
}

func (a *App) noteLocked(kind, format string, args ...any) {
	m := message{At: time.Now(), Kind: kind, Text: fmt.Sprintf(format, args...)}
	a.p.Messages = append(a.p.Messages, m)
	if len(a.p.Messages) > 400 {
		a.p.Messages = append([]message(nil), a.p.Messages[len(a.p.Messages)-300:]...)
	}
	if a.out != nil {
		fmt.Fprintln(a.out, m.Text)
	}
}

func (a *App) doing(format string, args ...any) {
	s := fmt.Sprintf(format, args...)
	a.mu.Lock()
	a.p.Doing = s
	a.mu.Unlock()
}

// wait pauses before the next try: a.pause, doubled for every try before, or longer when the other side asked.
func (a *App) wait(ctx context.Context, try int, atLeast time.Duration) error {
	d := a.pause << min(try, 6)
	if atLeast > d {
		d = atLeast
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// sentence turns an error into a line for a person: a capital first letter and a full stop.
func sentence(err error) string {
	r := []rune(strings.TrimSpace(err.Error()))
	if len(r) == 0 {
		return ""
	}
	r[0] = unicode.ToUpper(r[0])
	s := string(r)
	if !strings.HasSuffix(s, ".") && !strings.HasSuffix(s, "?") {
		s += "."
	}
	return s
}

func minutes(d time.Duration) string {
	switch m := int(d.Minutes()); {
	case m < 1:
		return "under a minute"
	case m == 1:
		return "1 minute"
	default:
		return fmt.Sprintf("%d minutes", m)
	}
}

func hostName() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "laptop"
	}
	return strings.TrimSuffix(h, ".local")
}
