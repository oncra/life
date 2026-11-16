# Life Clips

Life Clips takes the sound clips off a Life Node during a visit and brings them to the Life Oracle. It runs on a
laptop and opens in your web browser. At the node it joins the node's WiFi, downloads every clip waiting there,
checks each one, and has the node sign them over to the laptop. Later, wherever the laptop is online, it sends them to
the oracle.

## Download

The node's page in the Life Oracle has a download button for each kind of laptop, which always gives the newest
version. The files are releases of [oncra/life](https://github.com/oncra/life/releases), under tags that start with
`clips-app-v` (the release marked Latest is the node's image, not this app):

| Laptop | File |
| :-- | :-- |
| Mac, any (Apple chip or Intel, macOS 12 or later) | `Life-Clips-Mac.zip`, the app, signed and notarized by Apple |
| Windows PC | `life-clips-windows.exe` |
| Mac, for the command line | `life-clips-mac-Apple-M1-or-later` or `life-clips-mac-Intel` |

`SHA256SUMS` lists the SHA-256 of the program files.

## First start

**macOS.** Open `Life-Clips-Mac.zip` if your browser did not unpack it, and double-click Life Clips. macOS asks once
whether to open an app from the internet: choose Open. The app has no window of its own: it opens in your browser,
and closing that page stops it. The first time it reaches a node, macOS asks whether Life Clips may find devices on
your local network: choose Allow, as that is how it reaches the node. You can move it to Applications first, or keep
it where it is.

**Windows.** Double-click `life-clips-windows.exe`. If Windows says "Windows protected your PC", click More info,
then Run anyway. A console window opens and the app appears in your browser. Keep that window open while you work.

**The Mac programs for the command line** are not signed. A browser saves them without permission to run; in
Terminal, `chmod +x ~/Downloads/life-clips-mac-*` gives it, and `~/Downloads/life-clips-mac-Apple-M1-or-later` (or
`-Intel`) starts it. If macOS refuses the file, allow it under System Settings > Privacy & Security > Open Anyway.
Apple menu > About This Mac says which Mac you have ("Chip: Apple M..." or "Processor: Intel").

## A visit in three steps

The node's WiFi name (`life-` and six letters and digits) and its password are on the node's page in the Life Oracle;
once the app has joined that WiFi it remembers them. The node's WiFi is on only during a visit, which you start at the
node.

1. **Connect to the node.** Type the WiFi name and password and press Join the node's WiFi. If that does not work,
   join the WiFi yourself from the WiFi menu, then press I am connected. The app shows how many clips are waiting and
   how many minutes are left in the visit.
2. **Download the clips.** Every waiting clip is downloaded and checked against its fingerprint (SHA-256), and the
   node signs the checked clips over to this laptop. Then the app tells the node it is done, and the node closes its
   WiFi. A clip that fails the check is listed with the reason and stays on the node. Downloading stops a minute
   before the visit ends, so the node can still sign over what the laptop has.
3. **Send to the oracle.** Any time later, wherever the laptop is online, press Send to the oracle. The oracle confirms
   each clip. Send them before the date the app shows: after it the oracle refuses them until the node has signed them
   over again, at a next visit.

## Where the clips are

In your home folder, in `Life Clips`: a folder per node, in it a folder per month, and the files named as on the node,
for example `Life Clips/life-x7k2qp/2026-05/<clip>.m4a`. Each node's folder also holds `state.json`, the app's record
of what it downloaded, what the node signed over and what the oracle confirmed. Leave it in place: it holds the node's
signatures.

## If the visit ends early

Nothing is lost. What the laptop did not download, or the node did not sign over, stays on the node. Come back at
another visit and download again: the app picks up where it stopped and does not download again what it already has.
You can quit the app at any time.

## When the node deletes its copies

Only once the oracle has the clips. Sending them from the laptop is not enough by itself: the oracle tells the node the
next time the node reports in, and only then does the node delete them. Until then they stay on the node.

## Command line

    life-clips                    open the app in the browser (the same as life-clips ui)
    life-clips fetch [--node URL] [--ssid NAME --password PASSWORD]
    life-clips send [--oracle URL]
    life-clips status

`--dir FOLDER`, or the environment variable `LIFE_CLIPS_DIR`, keeps the clips somewhere else, for example on an
external disk. `LIFE_CLIPS_WIFI_PASSWORD` gives `fetch` the WiFi password without putting it on the command line.
`life-clips ui --no-browser` prints the app's address instead of opening the browser.

## Building

Go 1.23 or later, and nothing else: `go build` in this folder, `go test ./...` for the tests. A tag `clips-app-v*`
builds the release files (`.github/workflows/clips-app.yml`). The Mac app is made from that release's two Mac programs
on a Mac that holds the Developer ID key, by `mac/make-mac-app.sh <tag>`: one program for both kinds of Mac (lipo),
the bundle (`mac/Info.plist`, the icon drawn by `mac/icon.py`), signed with the hardened runtime, notarized, stapled
and attached to the release as `Life-Clips-Mac.zip`. `mac/make-mac-app.sh <tag> --try DIR` builds it from programs in
DIR, signed ad hoc, to try. Started as the app, Life Clips ends 20 seconds after its page was closed (the page says
bye as it goes; a reload comes back in time), or after 30 minutes without a word from it, never during a download.
