# Life Clips

Life Clips takes the sound clips off a Life Node during a visit and brings them to the Life Oracle. It runs on a
laptop and opens in your web browser. At the node it joins the node's WiFi, downloads every clip waiting there,
checks each one, and has the node sign them over to the laptop. Later, wherever the laptop is online, it sends them to
the oracle.

## Download

Life Clips is published as a release of [oncra/life](https://github.com/oncra/life/releases), under a tag that starts
with `clips-app-v`. (The release marked Latest is the node's image, not this app.) Take the file for your laptop:

| Laptop | File |
| :-- | :-- |
| Mac with Apple silicon (M1 or later) | `life-clips-macos-arm64` |
| Mac with an Intel processor | `life-clips-macos-amd64` |
| Windows PC | `life-clips-windows-amd64.exe` |

A direct link has this form, with the version you want:
`https://github.com/oncra/life/releases/download/clips-app-v1.0.0/life-clips-macos-arm64`. Apple menu > About This
Mac says which Mac you have ("Chip: Apple M..." or "Processor: Intel"). `SHA256SUMS` beside the files lists their
SHA-256.

## First start

**macOS.** The app is not signed by Apple, so macOS asks once.

1. A browser saves the file without permission to run it. Open Terminal and type
   `chmod +x ~/Downloads/life-clips-macos-*`, then press Return.
2. In Finder, right-click the file, choose Open, then Open again. On macOS 15 or later, or when there is no Open
   button: close the message, go to System Settings > Privacy & Security, scroll down, click Open Anyway beside
   life-clips, and open the file again.
3. A Terminal window opens and the app appears in your browser. Keep that window open while you work: closing it
   stops the app.
4. If macOS asks whether Terminal may find devices on your local network, choose Allow. That is how the app reaches
   the node.

**Windows.** Double-click `life-clips-windows-amd64.exe`. If Windows says "Windows protected your PC", click More info,
then Run anyway. A console window opens and the app appears in your browser. Keep that window open while you work.

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
builds the release files (`.github/workflows/clips-app.yml`).
