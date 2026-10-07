# The golden image

**Download:** the built image is published as a GitHub release of this repository, [`life-node-v1.img.xz`](https://github.com/oncra/life/releases/latest/download/life-node-v1.img.xz) with [`life-node-v1.img.xz.sha256`](https://github.com/oncra/life/releases/latest/download/life-node-v1.img.xz.sha256) beside it (about 0.8 GB compressed, 9 GiB written). Login on the bench: user `life`, password `lifebox`, over SSH at `<NODE_HOSTNAME>.local` (mDNS), unless `life-node.env` sets `NODE_PASSWORD` or `NODE_SSH_KEY`, which it should before a node leaves the desk. Nothing per-node is inside the image, so one download serves every node.

One image, flashed per node. Nothing per-node is baked in: the tokens, hostname, bench WiFi and schedule choice arrive as `life-node.env` on the boot partition, and the first boot moves that file onto the data partition. Build it with `build.sh` (see the header for the exact command); the result is `life-node-v1-<date>.img`, 9 GiB uncompressed (the data partition inside it is 1 GiB and grows to the card at the first boot).

## Partitions

| | Size | Runtime | Holds |
| :-- | :-- | :-- | :-- |
| p1 boot (FAT) | 512 MiB | writable | `config.txt`, `cmdline.txt`; `life-node.env` before the first boot |
| p2 root (ext4) | 8 GiB, fixed | **read-only tmpfs overlay** (`overlayroot=tmpfs:recurse=0`) | OS, BirdNET-Go binary, node programs, units |
| p3 data (ext4, label `life-data`) | grows to the card at first boot | writable, `/data` | everything that must survive a reboot |

`/data` carries: `life-node/` (the env file, the soil queue, the push cursor), `birdnet-go/` (its config, database and model), `wittypi/` (the scheduler's scripts, schedule and logs), `nm-connections/`, `ssh/` (host keys), `log/journal/`. The corresponding paths on the root (`/var/lib/life-node`, `/var/lib/birdnet-go`, `/etc/NetworkManager/system-connections`, `/var/log/journal`) are symlinks into it, so nothing in the software needs to know.

A power cut at any moment leaves root untouched, because root is never written. What a power cut can lose is whatever was in flight on `/data` in that second, which is why the queue is appended and the push cursor advances only after the server has answered.

## Flashing a node

1. Write the image to a card (`dd` or Raspberry Pi Imager with *no* customisation; its customisation would try to write a root that is about to become read-only).
2. Copy `life-node.env.example` from the boot partition to `life-node.env` beside it and fill it in: three device tokens from `POST /api/v1/places/<place>/devices`, a hostname, `SCHEDULE=bench` for the desk, WiFi for the desk. Leave WiFi empty for the field.
3. Boot. `life-firstboot` grows p3, takes the env file, writes host keys, seeds the Witty Pi scripts. `life-schedule` writes the season's schedule into the Witty Pi. BirdNET-Go starts on the I2S microphone. The soil timer fires every 20 minutes, the push timer hourly (detections plus the heartbeat with the modem's cell), and `life-flush` runs on the way down with a `shutdown` heartbeat, so a planned sleep and a crash look different from the oracle. With `GUARD=1`, `life-guard check` runs before any of that at every boot: on an alarm boot it reports the loop and the cell first and silences the guard only inside a maintenance window.
4. SSH as `life` with the password given at build time or the key baked in. Check: `systemctl list-timers`, `journalctl -u life-soil`, `ls /data/life-node`.

## One image per node, ready to flash

`personalize.sh` puts a node's `life-node.env` on the boot partition of the golden image and recompresses it, so the builder only downloads, flashes and boots (no root needed: mtools writes the FAT partition inside the file; about 6 minutes on 4 cores). The result holds the node's device tokens and WiFi password, so it is handed over behind a login, never as a release asset.

    bash node/image/personalize.sh life-node-v1.img.xz node.env life-node-1.img.xz

A WiFi name with spaces goes in single quotes (`WIFI_SSID='Office WiFi'`); the script refuses an unquoted value with a space.

## Changing the root later

Root is read-only, so `apt-get` and edits under `/etc` vanish at the next reboot. To change it: `sudo raspi-config nonint disable_overlayfs && sudo reboot`, make the change, `sudo raspi-config nonint enable_overlayfs && sudo reboot`. Or take out `overlayroot=tmpfs:recurse=0` from `cmdline.txt` on the boot partition from any laptop. Better still, change `provision.sh` and rebuild, so the next node gets it too.

## BirdNET-Go

Runs as the `birdnet-go.service` from `/data/birdnet-go`. `build.sh` runs it once inside the chroot to write its default `config.yaml` and fetch the model, then sets `realtime.audio.export.enabled: false`. **Audio clip saving stays off.** Detections leave the node, sound does not. Its web UI is on port 8080 on the bench; there is no route to it from the field, which is intended.

The microphone is an INMP441 on I2S (pins 18, 19, 20), which Linux sees as the `googlevoicehat` sound card; `dtparam=audio=off` keeps it the only card on the node so BirdNET-Go's default source picks it.

## Perch v2 beside BirdNET (optional)

`PERCH_REGION=central-europe` at build time runs `perch-v2.sh` after the BirdNET-Go first run: it fetches Google's Perch v2, the int8 ARM build cut to Central Europe (46 MB, 873 classes, about 250 MB of RAM; Apache-2.0), from the HuggingFace repo BirdNET-Go's own model gallery uses, checks both files against pinned SHA-256 sums, puts them in `/data/birdnet-go/models/perch_v2/` and enables `perch_v2` next to `birdnet` in `config.yaml`. Both models listen to the same microphone. A detection backed by both is one detection with two contributions in BirdNET-Go's database, and `life-push` sends it once with `detector` set to `birdnet-go:birdnet+perch`, so the oracle can compare the models without counting a bird twice. Perch's sound events (engines, voices) stay on the node like every non-species label. Perch follows `birdnet.threshold` unless `perch.overridethreshold` is set.

A node that already runs the plain image can get the same without a reflash, because `/data` is writable: run `perch-v2.sh` against `/data` on the node and restart `birdnet-go`.

## Witty Pi

`life-wittypi` runs before both the daemon and the schedule. It lets them start only when a Witty Pi 4 answers on I2C **and** sits in the supply path (its own input voltage is up). A Witty Pi stacked on the Pi while the supply goes into the Pi's own USB-C can order a shutdown but cannot cut or restore power, and the halted Pi then draws about 1.8 W and never wakes; that happened on node 1's bench. When the check passes it also sets the board's **default ON** (register 17), so the Pi starts the moment the Witty Pi gets power instead of waiting for a press on K1. A node whose battery ran flat comes back on its own when the charge controller switches its load output on again. `WITTYPI_DEFAULT_ON=0` in the env keeps the button behaviour.

The UUGear software runs from `/data/wittypi` under `wittypi.service` instead of the `init.d` script its installer would write.

**The clock comes first.** Every alarm the Witty Pi sets is read against its own RTC, and UUGear's daemon copies that RTC into the system clock at boot and, in its own code, switches NTP off when it does. An RTC that was never set then holds the node at the wrong time for good, and on node 1's bench (2026-10-05) the schedule computed from it shut the Pi down a minute after boot. So `provision.sh` takes the `set-ntp 0` out of UUGear's `rtc_to_system`, and `life-schedule` turns NTP on, waits up to `CLOCK_WAIT` seconds (default 180) for a sync and writes the synced time into the RTC, keeping the moment in `/data/life-node/clock-ok`. Without a sync it trusts the RTC only if it is not behind that moment. A clock it cannot trust leaves the node on with no shutdown scheduled, and systemd runs `life-schedule` again every five minutes until the clock syncs.

**Then the schedule.** In summer (March to October) `life-schedule-wpi` computes the day's windows for the node's own place with `astral`: `DAY_HOURS` from civil dawn (default 8: the dawn chorus and the morning) and `DUSK_HOURS` from sunset (default 2: the evening chorus and the first hours of the bats, which leave the roost from about twenty minutes after sunset). The script is anchored on the most recent dawn, its four states add up to dawn-to-next-dawn exactly, and every boot rewrites it, so the drift of the sun is never more than a day old; the arithmetic is in UTC, so the nights the clocks change come out right. On 21 June at Amsterdam that is 04:27 to 12:27 and 22:06 to 00:06; on 7 October 07:17 to 15:17 and 19:03 to 21:03. In winter (November to February) it is `schedules/winter.wpi`, one hour from 07:00 at a fixed clock time so the sample does not drift around the daily cycle. `SCHEDULE=bench` is `schedules/bench.wpi`, 15 minutes in every hour. `schedules/summer.wpi` (10 h from 05:00) is only the fallback if the computation fails. `life-schedule` writes the script and runs UUGear's `runScript.sh` at every boot, after the clock is right, because the daemon has already run it once on whatever time the RTC held.

## Known limits

- A Pi that boots outside its window (a manual boot, or the load output coming back on in the afternoon after a flat battery) stays on until the end of the next window: that is how UUGear's `runScript.sh` treats an OFF state at boot. On a battery that just recovered, that is a night it did not need to spend.
- `/etc/machine-id` is baked at build time, so nodes from one image share it. Harmless for what the node does; fix if a fleet ever needs per-node journald identity.
- Password login over SSH is on, for the bench, with the published default `lifebox`. Set `NODE_PASSWORD` or `NODE_SSH_KEY` in `life-node.env` before a node leaves the desk; turn password login off in `sshd-life.conf` before a fleet.
- The image has been built and inspected on a workstation. Its first boot on a Pi is stage 0.4's gate in the [build plan](https://life.oncra.org/docs/build).
