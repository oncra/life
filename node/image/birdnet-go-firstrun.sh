#!/bin/bash
# Run once at image build time, inside the arm64 root with /data mounted: lets BirdNET-Go write its default
# config into /data/birdnet-go, then turns audio clip saving off. Detections leave the node, sound does not.
set -euo pipefail
D=/data/birdnet-go
rm -rf /root/.config/birdnet-go $D/.config          # a stale config anywhere in the search path would be reused
mkdir -p $D && cd $D
HOME=$D XDG_CONFIG_HOME=$D/.config timeout 180 birdnet-go --help >/dev/null 2>&1 || true
SRC=$(find $D/.config /root/.config -name config.yaml 2>/dev/null | head -1 || true)
[ -n "$SRC" ] || { echo "birdnet-go wrote no config"; exit 1; }
mv "$SRC" $D/config.yaml && rm -rf $D/.config /root/.config/birdnet-go
python3 - <<'PY'
import re, pathlib
p = pathlib.Path("/data/birdnet-go/config.yaml"); s = p.read_text()
# clip saving off: the 'export:' block under realtime.audio has 'enabled: true' as its first key
s2, n = re.subn(r"(\n        export:\n            debug: \w+\n            enabled: )true", r"\1false", s, count=1)
assert n == 1, "export.enabled not found where expected; inspect the config"
s2 = s2.replace("\n    locale: en-us", "\n    locale: en", 1)
# the default source is "sysdefault", which BirdNET-Go does not find on a node (device_found=false, the capture
# stream stays closed and it analyses nothing). The I2S microphone is the only sound card (dtparam=audio=off),
# so it is card 0, device 0, which BirdNET-Go names ":0,0".
s2, n = re.subn(r"(\n              device: )sysdefault", r'\1":0,0"', s2, count=1)
assert n == 1, "audio source device not found where expected; inspect the config"
p.write_text(s2)
print("clip saving off")
PY
grep -n "export:" -A 2 $D/config.yaml | head -4
mkdir -p $D/logs $D/clips
echo "birdnet-go config at $D/config.yaml"
