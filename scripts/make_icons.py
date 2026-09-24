#!/usr/bin/env python3
"""Render the desktop icons from the panel's brand mark (web/index.html favicon), standard library only.

Writes scripts/agentstalk.ico (Windows shortcut) and scripts/agentstalk.png (Linux launcher).
--check compares instead of writing, so the committed icons stay reproducible.
"""
import argparse
from pathlib import Path
import struct
import sys
import zlib

HERE = Path(__file__).resolve().parent
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
# Geometry in the favicon's 40-unit viewBox: rounded square and the outlined speech bubble.
BUBBLE = ((11, 12), (29, 12), (29, 24), (18, 24), (11, 29))
TOP, BOTTOM, WHITE = (0x27, 0x8c, 0x62), (0x1a, 0x6a, 0x49), (0xff, 0xff, 0xff)


def rounded_square(x, y):
    qx, qy = abs(x - 20) - 8, abs(y - 20) - 8
    outside = (max(qx, 0) ** 2 + max(qy, 0) ** 2) ** .5
    return outside + min(max(qx, qy), 0) - 11


def outline(x, y):
    best = 1e9
    for (ax, ay), (bx, by) in zip(BUBBLE, BUBBLE[1:] + BUBBLE[:1]):
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
        best = min(best, ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2) ** .5)
    return best


def render(size):
    """RGBA rows with signed-distance anti-aliasing; small sizes get a slightly heavier stroke."""
    unit = 40 / size
    half_stroke = max(2.2, 1.25 * unit) / 2
    rows = []
    for py in range(size):
        row = bytearray([0])
        y = (py + .5) * unit
        shade = min(1.0, max(0.0, (y - 1) / 38))
        base = [round(t + (b - t) * shade) for t, b in zip(TOP, BOTTOM)]
        for px in range(size):
            x = (px + .5) * unit
            fill = min(1.0, max(0.0, .5 - rounded_square(x, y) / unit))
            if not fill:
                row += b'\0\0\0\0'
                continue
            ink = min(fill, max(0.0, .5 - (outline(x, y) - half_stroke) / unit))
            color = [round((c * (fill - ink) + w * ink) / fill) for c, w in zip(base, WHITE)]
            row += bytes(color + [round(fill * 255)])
        rows.append(bytes(row))
    return b''.join(rows)


def png(size):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(render(size), 9)) + chunk(b'IEND', b'')


def ico(images):
    """Windows icon with PNG-compressed entries (supported since Windows Vista)."""
    header = struct.pack('<HHH', 0, 1, len(images))
    offset, entries, blobs = 6 + 16 * len(images), b'', b''
    for size, data in images:
        entries += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        blobs += data
    return header + entries + blobs


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true', help='Fail if the committed icons differ from a fresh render')
    args = parser.parse_args()
    images = {size: png(size) for size in ICO_SIZES}
    outputs = {HERE / 'agentstalk.ico': ico(sorted(images.items())), HERE / 'agentstalk.png': images[256]}
    stale = [p.name for p, data in outputs.items() if not p.is_file() or p.read_bytes() != data]
    if args.check:
        print('Icons are up to date.' if not stale else 'Stale icons: ' + ', '.join(stale))
        return 1 if stale else 0
    for path, data in outputs.items(): path.write_bytes(data)
    print('Wrote ' + ', '.join(p.name for p in outputs))
    return 0


if __name__ == '__main__':
    sys.exit(main())
