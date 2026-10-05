#!/usr/bin/env bash
# Add Google Perch v2 to a node image, next to BirdNET v2.4, so both listen to the same microphone and every
# detection says which model heard it. Run by build.sh when PERCH_REGION is set, after birdnet-go-firstrun.sh,
# with the image's data partition mounted at $1 (the node sees it as /data).
#
# The build is the int8 ARM one cut to a region: for central-europe 873 classes (675 species plus 198 sound
# events such as engines and voices), 46 MB, about 250 MB of RAM, which fits a Pi 4 with 2 GB beside BirdNET.
# Files come from the HuggingFace repo BirdNET-Go's own model gallery uses, pinned by SHA-256.
# Licence: the Perch v2 weights are Apache-2.0 (Google), so unlike the BirdNET v2.4 model (CC BY-NC-SA 4.0)
# they carry no non-commercial clause.
set -euo pipefail
DATA=${1:?data partition mount point}; REGION=${PERCH_REGION:?PERCH_REGION, e.g. central-europe}
HF=${HF_ENDPOINT:-https://huggingface.co}/tphakala/Perch-v2-Models/resolve/main/regional/$REGION
# region -> sha256 of the model and of the labels, from BirdNET-Go's model catalog (release 20260823)
case $REGION in
  central-europe) MODEL_SHA=a5b7da4d147679b3ef0f2cde39bc4cacabfa7a9c462fed7adac4935c8781813e; LABEL_SHA=ac7c30b45b85404bc67830e8341e53ea47ad0d899a30789454c072abc6828072 ;;
  *) echo "no pinned checksums for region $REGION; add them from internal/classifier/model_catalog_regional_gen.go"; exit 1 ;;
esac
DIR=$DATA/birdnet-go/models/perch_v2; mkdir -p "$DIR"
MODEL=perch_v2_${REGION}_int8_arm.onnx; LABELS=perch_v2_${REGION}_labels.txt
curl -fsSL -o "$DIR/$MODEL" "$HF/$MODEL"; curl -fsSL -o "$DIR/$LABELS" "$HF/$LABELS"
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
