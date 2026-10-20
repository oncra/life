#!/usr/bin/env bash
# Put BirdNET-Go's bat model on a node image: BattyBirdNET for a region, the classifier and its labels, and the
# BirdNET v2.4 embeddings model it runs on. Run by build.sh when BAT_REGION is set (default eu), with the image's
# data partition mounted at $1 (the node sees it as /data). The config is not touched here: life-bats writes it at
# boot, and only when an AudioMoth USB Microphone is plugged in, so a node without one runs as before.
#
# Files come from the HuggingFace repo BirdNET-Go's own model gallery uses, pinned by SHA-256 from its model catalog
# (internal/classifier/model_catalog.go, release 20260823). About 59 MB, nearly all of it the shared embeddings.
# Licence: BattyBirdNET is CC BY-NC-SA 4.0 (R.D. Zinck, github.com/rdz-oss/BattyBirdNET-Analyzer), like the BirdNET
# v2.4 model it builds on: free for research and the bench, not for a paid service. content/hardware.md has the
# CC BY 4.0 alternative (BSG-BAT), which BirdNET-Go does not run yet.
set -euo pipefail
DATA=${1:?data partition mount point}; REGION=${BAT_REGION:-eu}
HF=${HF_ENDPOINT:-https://huggingface.co}/tphakala/BattyBirdNET-onnx/resolve/main
case $REGION in
  eu) FILE_REGION=EU; MODEL_SHA=f316073482ab95f48d65ca76e8b2aaa572019b3d286ab07a68ba57cea52d12f7; LABEL_SHA=9ad705d4bcd93040929a059854df968acebefee9f7513e97a558871c3997e65e ;;
  *) echo "no pinned checksums for bat region $REGION; add them from internal/classifier/model_catalog.go"; exit 1 ;;
esac
EMB_SHA=b91139d3c63d55d742779a56531078bc88366a09bcc9bd6a9b703d425914c380
MODEL=BattyBirdNET-$FILE_REGION-256kHz_fp32.onnx; LABELS=BattyBirdNET-$FILE_REGION-256kHz_Labels.txt
EMB=birdnet-v24-embeddings.onnx
DIR=$DATA/birdnet-go/models/bat; mkdir -p "$DIR"
curl -fsSL -o "$DIR/$MODEL" "$HF/fp32/$MODEL"
curl -fsSL -o "$DIR/$LABELS" "$HF/labels/$LABELS"
curl -fsSL -o "$DIR/$EMB" "$HF/birdnet-v2.4-embeddings-fp32-dfttrunc.onnx"
printf '%s  %s\n%s  %s\n%s  %s\n' "$MODEL_SHA" "$DIR/$MODEL" "$LABEL_SHA" "$DIR/$LABELS" "$EMB_SHA" "$DIR/$EMB" | sha256sum -c --quiet
echo "bat model in place: $MODEL ($(wc -l < "$DIR/$LABELS") labels)"
