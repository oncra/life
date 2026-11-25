#!/bin/bash
# Encode one lossless hour into the lossy versions the test compares: encode.sh FILE.flac OUTDIR
# Opus gets 48 kHz: given 32 kHz, ffmpeg's libopus runs at 24 kHz and cuts everything above 12 kHz.
set -e
f="$1"; o="$2"; b=$(basename "$f" .flac)
ffmpeg -nostdin -v error -y -i "$f" -ac 1 -c:a aac -b:a 64k  "$o/$b.aac64.m4a"
ffmpeg -nostdin -v error -y -i "$f" -ac 1 -c:a aac -b:a 96k  "$o/$b.aac96.m4a"
ffmpeg -nostdin -v error -y -i "$f" -ac 1 -c:a aac -b:a 128k "$o/$b.aac128.m4a"
ffmpeg -nostdin -v error -y -i "$f" -ac 1 -c:a libmp3lame -b:a 96k "$o/$b.mp3_96.mp3"
ffmpeg -nostdin -v error -y -i "$f" -ac 1 -ar 48000 -c:a libopus -b:a 32k "$o/$b.opus32.ogg"
ffmpeg -nostdin -v error -y -i "$f" -ac 1 -ar 48000 -c:a libopus -b:a 64k "$o/$b.opus64.ogg"
