"""
Generates client/public/art/hands.png: the player's own hands for the
first-person view, as 32x32 pixel-art tiles in the style of David
Gervais' tiles (rounded shading in a few tones, dark outline).  Original
art for this project, drawn procedurally: each hand is a union of capsules
(palm, wrist, fingers, thumb), shaded by distance from each part's axis
with light from the upper left, with creases, knuckles and fingernails.

Rows: bare skin, then gloves matching Gervais' glove icons (leather,
gauntlets, mithral, caestus, alchemist's).  Columns: right hand, left hand
(the right hand mirrored).  Standard library only.

    python3 scripts/make-hand-tiles.py
"""
import math, os, struct, sys, zlib
N = 32

def png(path, w, h, rgba):
    raw = b''.join(b'\x00' + bytes(rgba[y*w*4:(y+1)*w*4]) for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)))
    cx, cy = ax + vx * t, ay + vy * t
    return math.hypot(px - cx, py - cy), t

# Back of a RIGHT hand raised (fingers up), seen by its owner: thumb on the left.
# Parts: (name, ax, ay, bx, by, radius)   coordinates in tile pixels (x right, y down)
PARTS = [
    ('palm',   15.5, 22.0, 17.5, 16.5, 6.6),
    ('wrist',  18.0, 31.5, 17.0, 23.0, 5.0),
    ('index',  12.2, 15.5, 10.6,  5.0, 1.75),
    ('middle', 15.6, 14.5, 15.4,  2.8, 1.85),
    ('ring',   19.2, 15.0, 20.0,  4.4, 1.75),
    ('pinky',  22.4, 17.0, 24.6,  8.6, 1.55),
    ('thumb',  11.0, 22.5,  5.2, 15.0, 1.9),
]

FINGERS = ('index', 'middle', 'ring', 'pinky', 'thumb')

def build():
    part = [[None] * N for _ in range(N)]
    shade = [[0.0] * N for _ in range(N)]
    along = [[0.0] * N for _ in range(N)]
    for y in range(N):
        for x in range(N):
            best = None
            for name, ax, ay, bx, by, r in PARTS:
                d, t = seg_dist(x + 0.5, y + 0.5, ax, ay, bx, by)
                if d <= r and (best is None or d - r < best[1]):
                    best = (name, d - r, d / r, t)
            if best:
                name, _, rel, t = best
                part[y][x] = name
                along[y][x] = t
                # Rounded shading: bright along each part's axis, darker at its edges;
                # light from the upper left
                s = 1.0 - rel ** 2 * 0.75
                s += -0.12 * ((x - 16) / 16) + -0.08 * ((y - 16) / 16)
                shade[y][x] = s
    return part, shade, along

def render(part, shade, along, pal):
    img = [0] * (N * N * 4)
    def put(x, y, c):
        i = (y * N + x) * 4
        img[i:i + 4] = [c[0], c[1], c[2], 255]
    for y in range(N):
        for x in range(N):
            p = part[y][x]
            if not p:
                # Outline: transparent pixel next to the hand
                if any(0 <= x + dx < N and 0 <= y + dy < N and part[y + dy][x + dx] for dx, dy in ((1,0),(-1,0),(0,1),(0,-1))):
                    put(x, y, pal['outline'])
                continue
            s = shade[y][x]
            t = along[y][x]
            # Creases between fingers (a different finger beside) are drawn dark
            crease = p in FINGERS and any(0 <= x + dx < N and part[y][x + dx] in FINGERS and part[y][x + dx] != p for dx in (1, -1))
            if crease: s -= 0.5
            # Knuckles: a highlight where each finger meets the hand
            if p in FINGERS and p != 'thumb' and t < 0.14: s += 0.22
            # The edge of the palm toward the little finger falls into shadow
            if p in ('palm', 'wrist') and x > 19: s -= 0.12 * (x - 19)
            lv = 'hi' if s > 0.86 else 'light' if s > 0.62 else 'mid' if s > 0.36 else 'dark'
            # Fingernails at the tips (gloves map 'nail' to their own colour)
            if p in FINGERS and t > (0.88 if p == 'thumb' else 0.82) and not crease and s > 0.45: lv = 'nail'
            put(x, y, pal[lv])
    return img

SKIN = {'outline': (34, 18, 12), 'dark': (138, 78, 52), 'mid': (192, 120, 84), 'light': (228, 164, 122), 'hi': (248, 204, 166), 'nail': (244, 214, 196)}

# Glove materials, from the colours of Gervais' glove icons
GLOVES = {
    'leather':   {'outline': (36, 20, 8),  'dark': (128, 74, 30),  'mid': (182, 116, 50), 'light': (220, 160, 82),  'hi': (242, 200, 124)},
    'gauntlets': {'outline': (34, 14, 8),  'dark': (104, 46, 28),  'mid': (152, 76, 48),  'light': (196, 116, 78),  'hi': (228, 158, 112)},
    'mithral':   {'outline': (24, 24, 28), 'dark': (84, 86, 94),   'mid': (134, 136, 146), 'light': (184, 186, 196), 'hi': (230, 232, 240)},
    'caestus':   {'outline': (8, 14, 48),  'dark': (22, 44, 150),  'mid': (42, 86, 210),  'light': (86, 136, 242),  'hi': (156, 196, 255)},
    'alchemist': {'outline': (60, 40, 0),  'dark': (176, 124, 0),  'mid': (224, 172, 12), 'light': (250, 212, 44),  'hi': (255, 242, 146)},
}
for g in GLOVES.values(): g['nail'] = g['light']
MATERIALS = [('skin', SKIN)] + list(GLOVES.items())

def mirror(img):
    out = [0] * (N * N * 4)
    for y in range(N):
        for x in range(N):
            out[(y*N+x)*4:(y*N+x)*4+4] = img[(y*N+N-1-x)*4:(y*N+N-1-x)*4+4]
    return out

def sheet(path):
    """Rows: skin, then each glove material; columns: right hand, left hand"""
    part, shade, along = build()
    rows = [(render(part, shade, along, pal)) for _, pal in MATERIALS]
    W, H = 2 * N, len(rows) * N
    out = [0] * (W * H * 4)
    for r, img in enumerate(rows):
        for c, tile in enumerate((img, mirror(img))):
            for y in range(N):
                o = ((r * N + y) * W + c * N) * 4
                out[o:o + N * 4] = tile[y * N * 4:(y + 1) * N * 4]
    png(path, W, H, out)
    return rows

if __name__ == '__main__':
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'client', 'public', 'art', 'hands.png')
    sheet(out)
    print('Wrote', os.path.normpath(out))

def preview(path, tiles, k=10, bg=(51, 51, 51)):
    """Nearest-neighbour preview of several tiles side by side, on a dark background"""
    W = len(tiles) * (N + 2) * k
    H = (N + 2) * k
    out = [0] * (W * H * 4)
    for i in range(W * H):
        out[i*4:i*4+4] = [bg[0], bg[1], bg[2], 255]
    for t, img in enumerate(tiles):
        ox = (t * (N + 2) + 1) * k
        for y in range(N):
            for x in range(N):
                j = (y * N + x) * 4
                if img[j + 3] == 0: continue
                for yy in range(k):
                    for xx in range(k):
                        o = ((k + y * k + yy) * W + ox + x * k + xx) * 4
                        out[o:o+4] = img[j:j+4]
    png(path, W, H, out)
