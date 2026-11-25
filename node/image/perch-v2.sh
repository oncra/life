#!/usr/bin/env bash
# Add Google Perch v2 to a node image, next to BirdNET v2.4, so both listen to the same microphone and every
# detection says which model heard it. Run by build.sh when PERCH_REGION is set, after birdnet-go-firstrun.sh,
# with the image's data partition mounted at $1 (the node sees it as /data).
#
# The build is the full-precision one cut to a region, build 2: for central-europe 888 classes, 71 MB, about 250 MB of
# RAM. Until BirdNET-Go 20261122 this took the int8 ARM build (46 MB); that release withdrew it from its gallery,
# because it disagreed with the full model too often on real audio, and rescaled the regional builds, whose scores had
# been too high (scaled against the region's species only). Files come from the HuggingFace repo BirdNET-Go's own model
# gallery uses, pinned by SHA-256.
# Licence: the Perch v2 weights are Apache-2.0 (Google), so unlike the BirdNET v2.4 model (CC BY-NC-SA 4.0)
# they carry no non-commercial clause.
set -euo pipefail
DATA=${1:?data partition mount point}; REGION=${PERCH_REGION:?PERCH_REGION, e.g. central-europe}
HF=${HF_ENDPOINT:-https://huggingface.co}/tphakala/Perch-v2-Models/resolve/main/regional/$REGION
# region -> sha256 of the model and of the labels, from BirdNET-Go's model catalog (release 20261122, variant
# no-dft-fp32-b2@<region> in internal/classifier/model_catalog_regional_gen.go)
case $REGION in
  central-europe) MODEL_SHA=716be1e2762b40f2b24bd51c14715b5d888c7d5394679e1c22b12affbd0c0cd4; LABEL_SHA=f30fd8b4bd6ac3308f577e3435aacd0f62df8cd65390a6d79a2dd845726d7968 ;;
  *) echo "no pinned checksums for region $REGION; add them from internal/classifier/model_catalog_regional_gen.go"; exit 1 ;;
esac
DIR=$DATA/birdnet-go/models/perch_v2; mkdir -p "$DIR"
# the names BirdNET-Go's gallery gives the files on disk, and the ones they have in the repo
MODEL=perch_v2_${REGION}_no_dft_b2.onnx; LABELS=perch_v2_${REGION}_labels_b2.txt
curl -fsSL -o "$DIR/$MODEL" "$HF/perch-v2-$REGION-no-dft-fp32-b2.onnx"; curl -fsSL -o "$DIR/$LABELS" "$HF/perch-v2-$REGION-labels-b2.txt"
printf '%s  %s\n%s  %s\n' "$MODEL_SHA" "$DIR/$MODEL" "$LABEL_SHA" "$DIR/$LABELS" | sha256sum -c --quiet
NODE_DIR=/data/birdnet-go/models/perch_v2
python3 - "$DATA/birdnet-go/config.yaml" "$NODE_DIR/$MODEL" "$NODE_DIR/$LABELS" <<'PY'
import re, sys, pathlib
p, model, labels = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]; s = p.read_text()
# perch: point it at the files (the gallery would do this when installing through the web UI)
s, n = re.subn(r"\nperch:\n", f"\nperch:\n    modelpath: {model}\n    labelpath: {labels}\n", s, count=1)
assert n == 1, "no top-level perch: block; inspect the config"
# models.enabled: BirdNET stays the primary, Perch runs beside it
s, n = re.subn(r"(\nmodels:\n    enabled:\n        - birdnet\n)", r"\1        - perch_v2\n", s, count=1)
assert n == 1, "models.enabled is not the default [birdnet]; inspect the config"
p.write_text(s)
print(f"perch v2 enabled: {model}")
PY
