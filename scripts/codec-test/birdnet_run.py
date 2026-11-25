"""Run BirdNET v2.4 over an audio file in 3-second chunks and keep every score of 0.05 or more: birdnet_run.py AUDIO OUT.npz

    BIRDNET_MODEL=.../BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite uv run --with ai-edge-litert --with numpy python birdnet_run.py ...

The model (CC BY-NC-SA 4.0) is not in this repository: BirdNET-Go ships it in internal/classifier/data.
The sound is decoded by ffmpeg at 48 kHz, mono, as BirdNET wants it; scores are the sigmoid of the logits (sensitivity 1).
"""
import os, subprocess, sys
import numpy as np
from ai_edge_litert.interpreter import Interpreter

MODEL = os.environ["BIRDNET_MODEL"]
SR, CH, B = 48000, 144000, 64

def load(path):
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)

def main(path, out):
    x = load(path)
    n = len(x) // CH
    chunks = x[: n * CH].reshape(n, CH)
    it = Interpreter(model_path=MODEL, num_threads=1)
    inp = it.get_input_details()[0]["index"]
    it.resize_tensor_input(inp, [B, CH]); it.allocate_tensors()
    outi = it.get_output_details()[0]["index"]
    rows = []
    for s in range(0, n, B):
        batch = chunks[s:s + B]
        k = len(batch)
        if k < B:
            batch = np.concatenate([batch, np.zeros((B - k, CH), np.float32)])
        it.set_tensor(inp, batch.astype(np.float32)); it.invoke()
        logits = it.get_tensor(outi)[:k]
        sc = 1 / (1 + np.exp(-np.clip(logits, -15, 15)))
        ci, li = np.nonzero(sc >= 0.05)
        rows.append(np.stack([ci + s, li, (sc[ci, li] * 1e4).astype(np.int64)], 1))
    r = np.concatenate(rows) if rows else np.zeros((0, 3), np.int64)
    np.savez_compressed(out, det=r, n=n)
    print(path.split("/")[-1], n, len(r))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
