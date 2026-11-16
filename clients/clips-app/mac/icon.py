#!/usr/bin/env python3
"""icon.py OUT.png: Life Clips' icon, 1024 by 1024: the Life Oracle's green on the rounded square of a Mac app, with
the bars of a sound clip in white. Python's standard library only; make-mac-app.sh turns it into AppIcon.icns."""
import math
import struct
import sys
import zlib

N = 1024
GREEN_TOP, GREEN_BOTTOM = (0x3A, 0x7D, 0x46), (0x2A, 0x5F, 0x33)   # around the site's accent, #2f6b3a
BODY = (100, 100, 924, 924, 185)                                   # the Mac icon grid: 824 square, radius 185
BARS = [0.24, 0.46, 0.78, 1.0, 0.62, 0.38, 0.2]                    # a clip's loudness, as the bars of a waveform
BAR_W, GAP, TALL = 56, 30, 440


def rounded(px: float, py: float, x0: float, y0: float, x1: float, y1: float, r: float) -> float:
    """How much of the pixel at (px, py) a rounded rectangle covers, from its signed distance (one pixel of blur)."""
    cx, cy, hx, hy = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    qx, qy = abs(px - cx) - (hx - r), abs(py - cy) - (hy - r)
    d = math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r
    return min(1.0, max(0.0, 0.5 - d))


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    width = len(BARS) * BAR_W + (len(BARS) - 1) * GAP
    bars = []
    for i, h in enumerate(BARS):
        x0 = (N - width) / 2 + i * (BAR_W + GAP)
        half = TALL * h / 2
        bars.append((x0, N / 2 - half, x0 + BAR_W, N / 2 + half, BAR_W / 2))
    rows = bytearray()
    for y in range(N):
        t = (y - BODY[1]) / (BODY[3] - BODY[1])
        t = min(1.0, max(0.0, t))
        g = [round(a + (b - a) * t) for a, b in zip(GREEN_TOP, GREEN_BOTTOM)]
        live = [b for b in bars if b[1] - 1 <= y + 0.5 <= b[3] + 1]
        rows.append(0)   # PNG filter: none
        for x in range(N):
            px, py = x + 0.5, y + 0.5
            a = rounded(px, py, *BODY)
            if a == 0.0:
                rows += b"\0\0\0\0"
                continue
            w = 0.0
            for b in live:
                if b[0] - 1 <= px <= b[2] + 1:
                    w = max(w, rounded(px, py, *b))
            c = [round(v + (255 - v) * w) for v in g]
            rows += bytes((c[0], c[1], c[2], round(255 * a)))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", N, N, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b"")
    with open(sys.argv[1], "wb") as f:
        f.write(png)
    return 0


if __name__ == "__main__":
    sys.exit(main())
