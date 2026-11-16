#!/usr/bin/env bash
# Life-Clips-Mac.zip for a clips-app release: the release's two Mac programs as one app for Apple silicon and Intel,
# signed with a Developer ID, notarized by Apple and stapled, so that it opens with a double click; then attached to
# the same release, where the node page's Mac download finds it (src/app/download/life-clips/[os]/route.ts).
#
#   clients/clips-app/mac/make-mac-app.sh clips-app-v1.1.0              after CI has released the tag
#   clients/clips-app/mac/make-mac-app.sh clips-app-v1.1.0 --try DIR    from the programs in DIR, named as in a release,
#                                                                       signed ad hoc, nothing sent: DIR/Life-Clips-Mac.zip
#
# On a Mac with Apple's command line tools (codesign, notarytool, stapler, lipo, sips, iconutil) and gh with write
# access to oncra/life. The secrets stay out of the repository, named by the environment:
#   DEVID_KEY, DEVID_CERT                    the Developer ID Application key (PEM) and its certificate (.cer)
#   SLAGEN_ASC_KEY_PATH, SLAGEN_ASC_KEY_ID,  an App Store Connect API key, for the notary service
#   SLAGEN_ASC_ISSUER_ID
set -euo pipefail

tag=${1:?usage: make-mac-app.sh clips-app-vX.Y.Z [--try DIR]}
try=
if [ "${2:-}" = "--try" ]; then try=$(cd "${3:?--try needs a folder}" && pwd); fi
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
kc="$work/sign.keychain-db"
keychains=()   # the user's keychain search list as it was, put back when this ends
cleanup() {
  if [ ${#keychains[@]} -gt 0 ]; then security list-keychains -d user -s "${keychains[@]}" 2>/dev/null || true; fi
  security delete-keychain "$kc" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

arm=life-clips-mac-Apple-M1-or-later intel=life-clips-mac-Intel
if [ -n "$try" ]; then
  src=$try
else
  for v in DEVID_KEY DEVID_CERT SLAGEN_ASC_KEY_PATH SLAGEN_ASC_KEY_ID SLAGEN_ASC_ISSUER_ID; do
    [ -n "${!v:-}" ] || { echo "$v is not set (the credential store's .env)" >&2; exit 2; }
  done
  src=$work
  gh release download "$tag" -R oncra/life -D "$src" -p "$arm" -p "$intel"
fi

# the app: one program for both kinds of Mac, the page's icon, the bundle's description
app="$work/Life Clips.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
lipo -create -output "$app/Contents/MacOS/life-clips" "$src/$arm" "$src/$intel"
chmod 755 "$app/Contents/MacOS/life-clips"
sed "s/@VERSION@/${tag#clips-app-v}/g" "$here/Info.plist" > "$app/Contents/Info.plist"
plutil -lint -s "$app/Contents/Info.plist"
python3 "$here/icon.py" "$work/icon.png"
mkdir "$work/AppIcon.iconset"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" "$work/icon.png" --out "$work/AppIcon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$work/icon.png" --out "$work/AppIcon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$work/AppIcon.iconset" -o "$app/Contents/Resources/AppIcon.icns"

if [ -n "$try" ]; then
  codesign --force --sign - "$app"
  codesign --verify --strict "$app"
  rm -f "$try/Life-Clips-Mac.zip"
  ditto -c -k --keepParent "$app" "$try/Life-Clips-Mac.zip"
  echo "$try/Life-Clips-Mac.zip: signed ad hoc, not notarized"
  exit 0
fi

# a keychain of its own for the signing, deleted when this ends: no prompts, nothing left in the login keychain. It
# joins the search list while it lives, as codesign builds the chain it embeds (up to Apple's G2 intermediate, which
# macOS does not ship) from that list; the list is put back as it was.
pw=$(openssl rand -hex 16)
while IFS= read -r k; do k=${k#*\"}; keychains+=("${k%\"*}"); done < <(security list-keychains -d user)
security create-keychain -p "$pw" "$kc"
security list-keychains -d user -s "$kc" ${keychains[@]+"${keychains[@]}"}
security set-keychain-settings "$kc"
security unlock-keychain -p "$pw" "$kc"
curl -fsSL -o "$work/g2.cer" https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer   # the intermediate
security import "$work/g2.cer" -k "$kc" >/dev/null
security import "$DEVID_CERT" -k "$kc" >/dev/null
security import "$DEVID_KEY" -k "$kc" -t priv -f openssl -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$pw" "$kc" >/dev/null
id=$(security find-identity -v -p codesigning "$kc" | awk '/Developer ID Application/ {print $2; exit}')
[ -n "$id" ] || { echo "DEVID_KEY and DEVID_CERT make no Developer ID Application identity" >&2; exit 1; }
codesign --force --options runtime --timestamp --keychain "$kc" --sign "$id" "$app"
codesign --verify --strict --verbose=2 "$app"

# Apple's notary service checks it; the ticket is stapled into the app, so it opens without a connection too
ditto -c -k --keepParent "$app" "$work/submit.zip"
out=$(xcrun notarytool submit "$work/submit.zip" --key "$SLAGEN_ASC_KEY_PATH" --key-id "$SLAGEN_ASC_KEY_ID" \
  --issuer "$SLAGEN_ASC_ISSUER_ID" --wait --timeout 30m --output-format json)
status=$(plutil -extract status raw -o - - <<<"$out")
if [ "$status" != "Accepted" ]; then
  echo "the notary service says $status" >&2
  xcrun notarytool log "$(plutil -extract id raw -o - - <<<"$out")" --key "$SLAGEN_ASC_KEY_PATH" \
    --key-id "$SLAGEN_ASC_KEY_ID" --issuer "$SLAGEN_ASC_ISSUER_ID" >&2 || true
  exit 1
fi
xcrun stapler staple "$app"
spctl --assess --type execute --verbose=2 "$app"
ditto -c -k --keepParent "$app" "$work/Life-Clips-Mac.zip"
gh release upload "$tag" "$work/Life-Clips-Mac.zip" -R oncra/life --clobber
echo "Life-Clips-Mac.zip is on $tag: signed, notarized and stapled"
