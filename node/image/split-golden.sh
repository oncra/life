#!/usr/bin/env bash
# Prepare a golden image for the oracle's per-box images (/box on the site, src/lib/boximage.ts).
# Splits it at the start of the root partition: the boot part stays raw (each box gets its life-node.env
# written into it, then it is compressed alone, in seconds), the rest is compressed once and shared.
#
#   bash node/image/split-golden.sh life-node-v1.img.xz OUTDIR     # then copy OUTDIR to /opt/life/images/golden
set -euo pipefail
IN=${1:?golden .img.xz}; OUT=${2:?output directory}
HEAD_BYTES=$((1064960 * 512))      # root partition starts at sector 1064960 in every image build.sh makes
mkdir -p "$OUT"
TMP="$OUT/.full.img"; trap 'rm -f "$TMP"' EXIT
xz -dc "$IN" | dd of="$TMP" bs=4M conv=sparse status=none
[ "$(od -An -tx1 -j510 -N2 "$TMP" | tr -d ' ')" = 55aa ] || { echo "no partition table; not an image"; exit 1; }
dd if="$TMP" of="$OUT/head.img" bs=512 count=1064960 conv=sparse status=none
tail -c +$((HEAD_BYTES + 1)) "$TMP" | xz -T0 -6 > "$OUT/tail.xz"
# check: the two parts give back the image bit for bit
[ "$( (cat "$OUT/head.img"; xz -dc "$OUT/tail.xz") | sha256sum)" = "$(sha256sum < "$TMP")" ] || { echo "split does not round-trip"; exit 1; }
echo "$(date +%F) $(sha256sum "$IN" | cut -c1-8)" > "$OUT/VERSION"
ls -la "$OUT"; cat "$OUT/VERSION"
