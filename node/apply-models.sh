#!/bin/bash
# Bring a running node to BirdNET-Go 20261122 with BirdNET+ V3.0 and Perch v2 at full precision beside BirdNET v2.4,
# all three on the bird microphone, so the models can be compared on the same air. Without a new image.
#
#     sudo bash node/apply-models.sh birdnet-go-linux-arm64-20261122.tar.gz --accept-birdnet-aup [--dry-run]
#
# Fetch the release on a laptop or the box, never on the node over 4G, and copy it with the repository's node/ folder:
#     gh release download 20261122 --repo tphakala/birdnet-go --pattern 'birdnet-go-linux-arm64-20261122.tar.gz'
#     scp -r node birdnet-go-linux-arm64-20261122.tar.gz life@<hostname>:
# The release is checked against the SHA-256 below (from the release's checksums.txt). The two models come from
# BirdNET-Go's own model gallery, which checks every file against its catalog: BirdNET+ V3.0.1 for Central Europe
# (fp32, build 2, about 107 MB, with BirdNET's Geomodel for the range filter) and Perch v2 for Central Europe (fp32,
# build 2, about 71 MB; it replaces the int8 build, which BirdNET-Go withdrew in 20261122 because it disagreed with the
# full model too often). They are downloaded by the node, so it must be on its cable or WiFi; on the 4G stick this
# refuses. BirdNET+ V3.0 is Apache-2.0 with an acceptable-use policy (no poaching, no weapons or military targeting,
# no covert surveillance of people); its install records that the policy was agreed to, so --accept-birdnet-aup must
# be given on purpose. BirdNET v2.4 keeps running as the reference; the bat model is left as it is.
#
# Root is a read-only overlay, so the program goes into the live root and the one under it (/media/root-ro). The old
# config.yaml is kept beside the new one; to go back: the old birdnet-go binary is kept as birdnet-go.before-20261122.
set -euo pipefail
TARBALL=${1:-}; shift || true
ACCEPT=0; DRY=0
for a in "$@"; do case $a in --accept-birdnet-aup) ACCEPT=1 ;; --dry-run) DRY=1 ;; *) echo "unknown argument $a"; exit 1 ;; esac; done
RELEASE=20261122
TARBALL_SHA=538f54b68f7b4d823c184235e7d79b70b45e7741569064331db11440b95f68aa
API=${BIRDNET_API:-http://127.0.0.1:8080/api/v2}
CONFIG=${BIRDNET_CONFIG:-/data/birdnet-go/config.yaml}
LOWER=/media/root-ro
# BirdNET-Go's catalog ids and variants (internal/conf/consts.go, internal/classifier/model_catalog_regional_gen.go)
GEO=birdnet-geomodel-v3
PLUS=birdnet-plus-v3.0; PLUS_VARIANT=fp32-3.0.1-b2@central-europe
PERCH=perch-v2; PERCH_VARIANT=no-dft-fp32-b2@central-europe
# the sha256 of the documents an install agrees to (internal/classifier/model_catalog_documents_gen.go, 20261122):
# BirdNET+ V3.0.1's acceptable-use policy, and the Geomodel's that comes with it
AUP_PLUS=4495ebf9a088a83f902bbbef95ec17f635b51c94ade5d95b5d248646ea70a04e
AUP_GEO=acef17f7e6fc94463b2d9e4614d37f38448a332bbdb48e73a4a286941c492272
# the ids models.enabled takes: v2.4, Perch v2, BirdNET+ V3.0 (and the bat model, kept when it is there)
ENABLE="birdnet perch_v2 birdnet_plus_v3.0"

bngver() {  # the running BirdNET-Go version from its own API (the program has no --version, and running it writes a config)
  curl -fsS "${API:-http://127.0.0.1:8080/api/v2}/app/config" 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin).get(\"version\", \"unknown\"))" 2>/dev/null || echo unknown
}
say() { echo "apply-models: $*"; }
run() { if [ $DRY = 1 ]; then echo "would: $*"; else "$@"; fi; }
[ -n "$TARBALL" ] && [ -f "$TARBALL" ] || { echo "usage: sudo bash node/apply-models.sh birdnet-go-linux-arm64-$RELEASE.tar.gz --accept-birdnet-aup [--dry-run]"; exit 1; }
[ $DRY = 1 ] || [ "$(id -u)" = 0 ] || { echo "run it with sudo"; exit 1; }
[ $ACCEPT = 1 ] || { echo "BirdNET+ V3.0 comes with an acceptable-use policy (github.com/birdnet-team/birdnet-V3.0-dev, ACCEPTABLE_USE.md); give --accept-birdnet-aup to install it"; exit 1; }
[ -f "$CONFIG" ] || { echo "no $CONFIG: is this a Life node with BirdNET-Go?"; exit 1; }
echo "$TARBALL_SHA  $TARBALL" | sha256sum -c --quiet || { echo "$TARBALL is not BirdNET-Go $RELEASE as published; nothing changed"; exit 1; }
# the gallery downloads go over the node's own way out: the cable or the WiFi, never the 4G stick
DEV=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1)
case $DEV in eth0|wlan0) say "way out: $DEV" ;; *) echo "the way out is ${DEV:-none}, not the cable or the WiFi: the models are about 200 MB, which the SIM must never carry; nothing changed"; exit 1 ;; esac
command -v curl >/dev/null || { echo "curl is missing"; exit 1; }

JAR=$(mktemp)   # the cookie jar: csrf() runs in a subshell, so the file must exist out here
csrf() {  # BirdNET-Go refuses a POST without its CSRF token: the csrf cookie its web page sets, sent back as X-CSRF-Token
  curl -sS -c "$JAR" -o /dev/null "${API%/api/v2}/" || return 1
  awk '$6 == "csrf" {print $7}' "$JAR" | tail -1
}
api() {  # api METHOD PATH [JSON]: BirdNET-Go's API on the node's loopback; prints the body, fails on an HTTP error
  local code body tok=""
  body=$(mktemp)
  [ "$1" = GET ] || tok=$(csrf) || { rm -f "$body"; return 1; }
  code=$(curl -sS -o "$body" -w '%{http_code}' -X "$1" -H 'content-type: application/json' -b "$JAR" ${tok:+-H "X-CSRF-Token: $tok"} ${3:+--data "$3"} "$API$2") || { rm -f "$body"; return 1; }
  cat "$body"; rm -f "$body"
  case $code in 2??) return 0 ;; 401|403) echo; echo "BirdNET-Go asks for a sign-in ($code) on $2: this node has security on; install the models from its web page" >&2; return 1 ;; *) echo; echo "HTTP $code on $1 $2" >&2; return 1 ;; esac
}
up() { for _ in $(seq 1 60); do curl -fsS -o /dev/null "$API/models/installed" 2>/dev/null && return 0; sleep 2; done; return 1; }

# 1. the program
WORK=$(mktemp -d); trap 'rm -rf "$WORK" "$JAR"' EXIT
tar -xzf "$TARBALL" -C "$WORK"
BIN=$(find "$WORK" -maxdepth 2 -type f -name birdnet-go | head -1)
[ -n "$BIN" ] || { echo "no birdnet-go in $TARBALL"; exit 1; }
LIBS=$(find "$WORK" -maxdepth 2 -type f -name 'lib*.so*')
CUR=$(bngver 2>/dev/null | head -1 || true)
say "BirdNET-Go now: ${CUR:-unknown}; installing $RELEASE"
STAMP=$(date +%Y%m%d-%H%M%S)
run cp -a "$CONFIG" "$CONFIG.before-models-$STAMP"
ROOTS=(/)
cleanup_lower() { if mountpoint -q "$LOWER"; then mount -o remount,ro "$LOWER" || echo "could not make $LOWER read-only again: reboot"; fi; }
if mountpoint -q "$LOWER" && [ $DRY = 0 ]; then
  mount -o remount,rw "$LOWER"
  trap 'cleanup_lower; rm -rf "$WORK" "$JAR"' EXIT
  ROOTS+=("$LOWER")
fi
run systemctl stop birdnet-go.service
for R in "${ROOTS[@]}"; do
  [ -e "${R%/}/usr/local/bin/birdnet-go.before-$RELEASE" ] || run cp -a "${R%/}/usr/local/bin/birdnet-go" "${R%/}/usr/local/bin/birdnet-go.before-$RELEASE"
  run install -m 0755 "$BIN" "${R%/}/usr/local/bin/birdnet-go"
  for l in $LIBS; do run install -m 0644 "$l" "${R%/}/usr/local/lib/"; done
done
run ldconfig
run systemctl start birdnet-go.service
if [ $DRY = 1 ]; then say "dry run: the models would now be installed and enabled ($ENABLE)"; exit 0; fi
up || { echo "BirdNET-Go $RELEASE did not answer within two minutes; see journalctl -u birdnet-go. The old program is birdnet-go.before-$RELEASE"; exit 1; }
say "BirdNET-Go: $(bngver 2>/dev/null | head -1)"

# 2. the models, from BirdNET-Go's gallery
# both depend on the Geomodel (the range filter), which has its own acceptable-use policy and goes in first: an
# install agrees only to the documents of the model it names
installed() { api GET "/models/catalog" 2>/dev/null | python3 -c 'import sys, json; print(any(m["id"] == sys.argv[1] and m.get("installed") for m in json.load(sys.stdin)["catalog"]))' "$1" 2>/dev/null; }
if [ "$(installed $GEO)" != True ]; then
  api POST "/models/install/$GEO" "{\"acceptedDocuments\":[\"$AUP_GEO\"]}" >/dev/null
  say "installing $GEO"
  for i in $(seq 1 60); do [ "$(installed $GEO)" = True ] && break; [ "$i" = 60 ] && { echo "$GEO was not installed within 10 minutes"; exit 1; }; sleep 10; done
fi
# one install at a time (BirdNET-Go answers 409 to a second while the first runs)
if ! api GET /models/installed 2>/dev/null | grep -q "$PLUS_VARIANT"; then
  api POST "/models/install/$PLUS" "{\"variantId\":\"$PLUS_VARIANT\",\"acceptedDocuments\":[\"$AUP_PLUS\"]}" >/dev/null || true
  say "installing $PLUS ($PLUS_VARIANT)"
  for i in $(seq 1 120); do api GET /models/installed 2>/dev/null | grep -q "$PLUS_VARIANT" && break; [ "$i" = 120 ] && { echo "$PLUS was not installed within 20 minutes"; exit 1; }; sleep 10; done
fi
if ! api GET /models/installed 2>/dev/null | grep -q "$PERCH_VARIANT"; then
  api POST "/models/install/$PERCH" "{\"variantId\":\"$PERCH_VARIANT\"}" >/dev/null
  say "installing $PERCH ($PERCH_VARIANT)"
fi
for i in $(seq 1 120); do
  inst=$(api GET /models/installed 2>/dev/null || true)
  if grep -q "$PLUS_VARIANT" <<<"$inst" && grep -q "$PERCH_VARIANT" <<<"$inst"; then say "both installed"; break; fi
  [ "$i" = 120 ] && { echo "the models were not installed within 20 minutes; GET $API/models/installed says:"; echo "$inst"; exit 1; }
  sleep 10
done

# 3. all three on the bird microphone: models.enabled names them, and every bird source lists them. life-mic rewrites
# the AudioMoth's source itself (every enabled model but the bat model) but leaves an I2S source's list as it is, so
# that list is done here; the I2S witness keeps BirdNET alone, and the bat source its bat model
python3 - "$CONFIG" $ENABLE <<'PY2'
import re, sys, pathlib
p, want = pathlib.Path(sys.argv[1]), sys.argv[2:]
lines = p.read_text().split("\n")
out, did = [], []
i = 0
while i < len(lines):
    line = lines[i]
    out.append(line)
    top = line == "models:"
    sub = re.match(r"^(\s+)models:\s*$", line)
    if top or sub:
        j, items = i + 1, []
        if top:  # models.enabled
            if j < len(lines) and re.match(r"^\s+enabled:\s*$", lines[j]):
                out.append(lines[j]); j += 1
            else:
                i += 1; continue
        while j < len(lines) and re.match(r"^\s+- \S", lines[j]) and (top or len(lines[j]) - len(lines[j].lstrip()) > len(sub.group(1))):
            items.append(lines[j]); j += 1
        names = [x.strip()[2:].strip().strip("'\"") for x in items]
        source = next((re.sub(r"^\s*- name:\s*", "", lines[k]).strip() for k in range(i, -1, -1) if re.match(r"^\s*- name:", lines[k])), None)
        bird = top or ("birdnet" in names and source != "I2S witness")
        add = [w for w in want if w not in names] if bird and items else []
        out += items
        if add:
            pad = items[-1][:len(items[-1]) - len(items[-1].lstrip())]
            out += [f"{pad}- {w}" for w in add]
            did.append(f"{'models.enabled' if top else source}: + {', '.join(add)}")
        i = j
        continue
    i += 1
if did:
    p.write_text("\n".join(out))
print("; ".join(did) or "every bird source already lists the three models")
PY2
if command -v life-mic >/dev/null; then life-mic sync || true; else systemctl restart birdnet-go.service; fi
up || { echo "BirdNET-Go did not come back after the models were enabled; see journalctl -u birdnet-go"; exit 1; }
say "done. Sources and their models:"
life-mic status 2>/dev/null | grep -E "^(mode|plugged|sources):" || true
