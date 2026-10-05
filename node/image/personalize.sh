#!/usr/bin/env bash
# Make a ready-to-flash image for one node: the golden image with that node's life-node.env already on the
# boot partition, so the builder only downloads, flashes and boots. No root needed (mtools writes the FAT
# partition inside the image file directly). Needs: xz-utils, mtools.
#
#   bash node/image/personalize.sh life-node-v1.img.xz my-node.env life-node-1-office.img.xz
#
# The result carries the node's device tokens and WiFi password: it is a secret, like the env file itself.
# Hand it over behind a login, never as a public release asset.
set -euo pipefail
BASE=${1:?golden image .img.xz}; ENV=${2:?life-node.env for this node}; OUT=${3:?output .img.xz}
command -v mcopy >/dev/null || { echo "needs mtools (apt-get install mtools)"; exit 1; }
grep -q '^NODE_HOSTNAME=' "$ENV" || { echo "$ENV has no NODE_HOSTNAME; is it a life-node.env?"; exit 1; }
# values with spaces (a WiFi name, an SSH key) must be quoted, or the shell that reads the file at boot splits them
if grep -E '^[A-Z0-9_]+=[^"'"'"'#]*[^[:space:]#][[:space:]]+[^#[:space:]]' "$ENV" | grep -v '^#'; then
  echo "the line(s) above have a space in an unquoted value; put the value in single quotes"; exit 1
fi
IMG=${OUT%.xz}; [ "$IMG" != "$OUT" ] || { echo "output must end in .xz"; exit 1; }
trap 'rm -f "$IMG"' EXIT
echo ">> extracting"; xz -dc "$BASE" | dd of="$IMG" bs=4M conv=sparse status=none
# p1 (boot, FAT) starts at sector 16384 in every image build.sh makes; mtools reaches it by byte offset
OFF=$((16384 * 512))
mdir -i "$IMG@@$OFF" ::cmdline.txt >/dev/null || { echo "no FAT boot partition at sector 16384; not a life node image"; exit 1; }
mcopy -o -i "$IMG@@$OFF" "$ENV" ::life-node.env
mdir -i "$IMG@@$OFF" ::life-node.env | grep -q 'life-node' && echo ">> life-node.env placed on the boot partition"
echo ">> compressing"; xz -T0 -6 -c "$IMG" > "$OUT"
(cd "$(dirname "$OUT")" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256")
ls -la "$OUT"; echo ">> $OUT ready: flash it as it is, no env file to copy"
