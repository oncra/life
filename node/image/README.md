# The golden image

One image, flashed per node. Nothing per-node is baked in: the tokens, hostname, bench WiFi and schedule choice arrive as `life-node.env` on the boot partition, and the first boot moves that file onto the data partition. Build it with `build.sh` (see the header for the exact command); the result is `life-node-v1-<date>.img`, about 12 GiB uncompressed.

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

## Changing the root later

Root is read-only, so `apt-get` and edits under `/etc` vanish at the next reboot. To change it: `sudo raspi-config nonint disable_overlayfs && sudo reboot`, make the change, `sudo raspi-config nonint enable_overlayfs && sudo reboot`. Or take out `overlayroot=tmpfs:recurse=0` from `cmdline.txt` on the boot partition from any laptop. Better still, change `provision.sh` and rebuild, so the next node gets it too.

## BirdNET-Go

Runs as the `birdnet-go.service` from `/data/birdnet-go`. `build.sh` runs it once inside the chroot to write its default `config.yaml` and fetch the model, then sets `realtime.audio.export.enabled: false`. **Audio clip saving stays off.** Detections leave the node, sound does not. Its web UI is on port 8080 on the bench; there is no route to it from the field, which is intended.

The microphone is an INMP441 on I2S (pins 18, 19, 20), which Linux sees as the `googlevoicehat` sound card; `dtparam=audio=off` keeps it the only card on the node so BirdNET-Go's default source picks it.

## Witty Pi

The UUGear software runs from `/data/wittypi` under `wittypi.service` instead of the `init.d` script its installer would write. `schedules/` has three scripts: `summer` (10 h from 05:00), `winter` (1 h from 07:00), `bench` (15 min in every hour). `life-schedule` picks by month unless `SCHEDULE=` in the env says otherwise, and only rewrites the Witty Pi when the wanted script differs from the one in place. The `astral` dawn/dusk computation from the node README is the intended replacement; it is installed but not yet wired in.

## Known limits

- `/etc/machine-id` is baked at build time, so nodes from one image share it. Harmless for what the node does; fix if a fleet ever needs per-node journald identity.
- Password login over SSH is on, for the bench. Turn it off in `sshd-life.conf` before a fleet.
- The image has been built and inspected on a workstation. Its first boot on a Pi is stage 0.4's gate in the [build plan](https://life.oncra.org/docs/build).
