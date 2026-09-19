#!/usr/bin/env bash
# Build the Life node golden image on a Linux workstation (x86_64 is fine: the arm64 root is entered
# through qemu-user-static). Needs root, and: qemu-user-static binfmt-support xz-utils util-linux e2fsprogs.
#
#   sudo LIFE_USER_PASSWORD=... [AUTHORIZED_KEYS=~/.ssh/id_ed25519.pub] \
#     bash node/image/build.sh raspios-lite-arm64.img.xz birdnet-go-linux-arm64.tar.gz wittyPi.zip out.img
#
# Layout of the result (12 GiB image; flash with dd or Raspberry Pi Imager, "no customisation"):
#   p1  boot, FAT      512 MiB   config.txt, cmdline.txt, and where life-node.env goes before the first boot
#   p2  root, ext4     ~7.5 GiB  read-only tmpfs overlay at runtime (overlayroot=tmpfs:recurse=0); fixed size
#   p3  data, ext4     rest      grows to the end of the card at the first boot; everything that must persist
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
BASE=${1:?base image .img.xz}; BNG_TGZ=${2:?birdnet-go tarball}; WITTY_ZIP=${3:?Witty Pi 4 zip}; OUT=${4:?output .img}
: "${LIFE_USER_PASSWORD:?set LIFE_USER_PASSWORD for the 'life' user}"
HERE=$(cd "$(dirname "$0")" && pwd); NODE=$(cd "$HERE/.." && pwd); REPO=$(cd "$NODE/.." && pwd)
WORK=$(mktemp -d); trap 'set +e; umount -R "$WORK/root" 2>/dev/null; [ -n "${LOOP:-}" ] && losetup -d "$LOOP"; rm -rf "$WORK"' EXIT
echo ">> extracting"; xz -dkc "$BASE" > "$OUT"
truncate -s 12G "$OUT"
# root to 8 GiB, data partition after it (sector numbers from the 2026-09-15 Pi OS layout: boot at 16384, root at 1064960)
printf 'label: dos\nunit: sectors\nsector-size: 512\n\n1 : start=16384, size=1048576, type=c\n2 : start=1064960, size=15712256, type=83\n3 : start=16777216, size=8388608, type=83\n' | sfdisk -q "$OUT"
LOOP=$(losetup -fP --show "$OUT")
e2fsck -fp "${LOOP}p2" >/dev/null; resize2fs "${LOOP}p2" >/dev/null 2>&1; mkfs.ext4 -q -L life-data "${LOOP}p3"
mkdir -p "$WORK/root" && mount "${LOOP}p2" "$WORK/root" && mount "${LOOP}p1" "$WORK/root/boot/firmware"
R="$WORK/root"
echo ">> staging"; mkdir -p "$R/tmp/stage/bng" "$R/tmp/stage/witty" "$R/tmp/stage/node"
tar xzf "$BNG_TGZ" -C "$R/tmp/stage/bng"; python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$WITTY_ZIP" "$R/tmp/stage/witty"
cp -r "$NODE"/. "$R/tmp/stage/node/"; mkdir -p "$R/tmp/stage/clients"; cp "$REPO/clients/birdnet-pi-push.py" "$R/tmp/stage/clients/"
[ -n "${AUTHORIZED_KEYS:-}" ] && cp "$AUTHORIZED_KEYS" "$R/tmp/stage/node/image/authorized_keys"
cp /usr/bin/qemu-aarch64-static "$R/usr/bin/"; cp -L /etc/resolv.conf "$R/etc/resolv.conf.build"
mount -t proc proc "$R/proc"; mount --rbind /sys "$R/sys"; mount --make-rslave "$R/sys"; mount --rbind /dev "$R/dev"; mount --make-rslave "$R/dev"
echo ">> installing inside the arm64 root"
chroot "$R" /bin/bash -c 'mv /etc/resolv.conf /etc/resolv.conf.orig; cp /etc/resolv.conf.build /etc/resolv.conf; apt-get update -qq; LIFE_USER_PASSWORD="$0" bash /tmp/stage/node/provision.sh /tmp/stage/bng /tmp/stage/witty; mv /etc/resolv.conf.orig /etc/resolv.conf; rm /etc/resolv.conf.build; apt-get clean' "$LIFE_USER_PASSWORD"
# BirdNET-Go: a first run writes its default config and fetches the model; then clip saving goes off
chroot "$R" /bin/bash -c 'bash /tmp/stage/node/image/birdnet-go-firstrun.sh'
rm -rf "$R/tmp/stage" "$R/usr/bin/qemu-aarch64-static"
umount -R "$R"; losetup -d "$LOOP"; LOOP=
echo ">> $OUT ready; compress with: xz -T0 -9 $OUT"
