# Codec test: does a lossy file change what BirdNET hears?

The test behind the codec table on the [research node](../../content/research-node.md) page (25 November 2026). Four lossless hours of Cornell's Sapsucker Woods soundscapes, each encoded as AAC, MP3 and Opus at several bitrates, BirdNET v2.4 on every version, and every version compared with the lossless hour and with the calls experts marked in it.

```sh
mkdir -p data/enc data/scores
uv run --with remotezip python fetch.py data SSW_008_20170225_120012Z.flac SSW_127_20170506_110007Z.flac \
    SSW_128_20170506_120007Z.flac SSW_144_20170513_090009Z.flac
for f in data/SSW_*.flac; do ./encode.sh "$f" data/enc; done
export BIRDNET_MODEL=/path/to/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite BIRDNET_DATA=/path/to/birdnet-go/internal/classifier/data
for f in data/SSW_*.flac data/enc/*; do
  uv run --with ai-edge-litert --with numpy python birdnet_run.py "$f" "data/scores/$(basename "$f").npz"
done
uv run --with numpy python analyze.py data
```

About 400 MB of audio, and a minute of BirdNET per hour of sound on one core. The model and its labels come with BirdNET-Go (`internal/classifier/data`) and are CC BY-NC-SA 4.0; they are not in this repository. Run two at a time at most on a machine with 8 GB: each run holds an hour of decoded sound in memory.

The same scripts take any lossless recording: the next step is the node's own microphone, a Dutch dawn, and Perch beside BirdNET.
