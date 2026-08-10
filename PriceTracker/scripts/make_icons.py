#!/usr/bin/env python3
"""
Generate the Price Tracker icon set with no third-party dependencies.

The icon is a rounded blue tile with a white descending "price trend" line and
a marker dot at the lowest point — a clean, legible mark for a price-drop
tracker. We render each size on a 4x supersampled canvas and box-downsample for
smooth anti-aliased edges, then encode PNGs using only the standard library.
"""
import math
import struct
import zlib
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "Extension", "Resources", "images")

BG = (47, 107, 255)      # accent blue (#2f6bff)
BG2 = (37, 86, 214)      # slightly darker for a subtle vertical gradient
FG = (255, 255, 255)     # white trend line
SS = 4                   # supersampling factor


def lerp(a, b, t):
    return a + (b - a) * t


def rounded_rect_alpha(x, y, w, h, r):
    """Coverage (0..1 handled by caller via SS) — here a hard in/out test."""
    # distance-to-rounded-rect inside test
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    if r <= 0:
        return 0.0 <= x <= w and 0.0 <= y <= h
    dx = x - cx
    dy = y - cy
    # inside the straight edges band
    if r <= x <= w - r or r <= y <= h - r:
        return 0 <= x <= w and 0 <= y <= h
    return (dx * dx + dy * dy) <= r * r


def point_segment_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    seg_len2 = vx * vx + vy * vy
    t = 0.0 if seg_len2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / seg_len2))
    cx, cy = ax + t * vx, ay + t * vy
    return math.hypot(px - cx, py - cy)


def render(size):
    S = size * SS
    r = S * 0.22            # corner radius
    # Trend line points (descending) in unit space, then scaled.
    pts_u = [(0.20, 0.34), (0.42, 0.55), (0.60, 0.44), (0.80, 0.72)]
    pts = [(x * S, y * S) for (x, y) in pts_u]
    line_w = S * 0.075
    dot = pts[-1]
    dot_r = S * 0.075

    # Supersampled pixel buffer at final size (accumulate SS*SS samples).
    out = bytearray(size * size * 4)
    for py in range(size):
        for px in range(size):
            ar = ag = ab = aa = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    fx = (px * SS) + sx + 0.5
                    fy = (py * SS) + sy + 0.5
                    inside_bg = rounded_rect_alpha(fx, fy, S, S, r)
                    if not inside_bg:
                        continue
                    # background gradient
                    t = fy / S
                    br = lerp(BG[0], BG2[0], t)
                    bg = lerp(BG[1], BG2[1], t)
                    bb = lerp(BG[2], BG2[2], t)
                    cr, cg, cb = br, bg, bb
                    # trend line
                    on_line = False
                    for i in range(len(pts) - 1):
                        d = point_segment_dist(fx, fy, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
                        if d <= line_w / 2:
                            on_line = True
                            break
                    if not on_line and math.hypot(fx - dot[0], fy - dot[1]) <= dot_r:
                        on_line = True
                    if on_line:
                        cr, cg, cb = FG
                    ar += cr
                    ag += cg
                    ab += cb
                    aa += 1.0
            n = SS * SS
            idx = (py * size + px) * 4
            if aa == 0:
                out[idx:idx + 4] = bytes((0, 0, 0, 0))
            else:
                out[idx + 0] = int(ar / n + 0.5) if aa == n else int(ar / aa + 0.5)
                out[idx + 1] = int(ag / n + 0.5) if aa == n else int(ag / aa + 0.5)
                out[idx + 2] = int(ab / n + 0.5) if aa == n else int(ab / aa + 0.5)
                out[idx + 3] = int(aa / n * 255 + 0.5)
    return bytes(out)


def write_png(path, rgba, size):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # no filter
        raw.extend(rgba[y * stride:(y + 1) * stride])
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (48, 96, 128, 256, 512):
        rgba = render(size)
        path = os.path.join(OUT_DIR, f"icon-{size}.png")
        write_png(path, rgba, size)
        print("wrote", os.path.relpath(path))


if __name__ == "__main__":
    main()
