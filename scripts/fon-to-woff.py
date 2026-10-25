#!/usr/bin/env python3
"""
Convert one of Angband's classic bitmap fonts (lib/fonts/*.fon, Windows
FON/FNT format) into a web font whose outlines are the exact original
pixels, so it renders pixel-perfect at integer multiples of its cell height.

  python3 scripts/fon-to-woff.py engine/upstream/lib/fonts/8x16x.fon client/public/fonts/angband-8x16.woff

Requires fontTools (dev-time only): pip install fonttools
The Angband fonts are by Leon Marrick, Sheldon Simms III and Nick McConnell
and are released under the GPL (see engine/upstream/docs/copying.rst).
"""
import struct
import sys

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

RT_FONT = 0x8008


def fnt_resources(data):
    """Yield raw FNT resources from an NE-format .fon file."""
    ne = struct.unpack_from('<I', data, 0x3C)[0]
    if data[ne:ne + 2] != b'NE':
        raise ValueError('not an NE executable')
    rsrc = ne + struct.unpack_from('<H', data, ne + 0x24)[0]
    shift = struct.unpack_from('<H', data, rsrc)[0]
    pos = rsrc + 2
    while True:
        rtype, count = struct.unpack_from('<HH', data, pos)
        if rtype == 0:
            return
        pos += 8
        for _ in range(count):
            off, length = struct.unpack_from('<HH', data, pos)
            pos += 12
            if rtype == RT_FONT:
                yield data[off << shift:(off << shift) + (length << shift)]


def parse_fnt(fnt):
    version = struct.unpack_from('<H', fnt, 0)[0]
    (ascent,) = struct.unpack_from('<H', fnt, 74)
    charset = fnt[85]
    pix_width, pix_height = struct.unpack_from('<HH', fnt, 86)
    first, last = fnt[95], fnt[96]
    face_off = struct.unpack_from('<I', fnt, 105)[0]
    face = fnt[face_off:fnt.index(b'\0', face_off)].decode('latin-1') if face_off else 'Angband'
    table = 118 if version == 0x200 else 148
    entry = 4 if version == 0x200 else 6
    glyphs = {}
    for i in range(last - first + 1):
        if version == 0x200:
            width, off = struct.unpack_from('<HH', fnt, table + i * entry)
        else:
            width, off = struct.unpack_from('<HI', fnt, table + i * entry)
        cols = (width + 7) // 8
        rows = []
        for y in range(pix_height):
            row = []
            for x in range(width):
                byte = fnt[off + (x // 8) * pix_height + y]
                row.append(bool(byte & (0x80 >> (x % 8))))
            rows.append(row)
        glyphs[first + i] = (width, rows)
    return dict(ascent=ascent, charset=charset, width=pix_width, height=pix_height, glyphs=glyphs, face=face)


def build(font, out_path, family):
    unit = 128                       # font units per bitmap pixel
    h = font['height']
    upm = h * unit                   # 1 em = one cell height
    ascent = font['ascent'] * unit
    codec = 'cp437' if font['charset'] == 255 else 'cp1252'

    order = ['.notdef']
    cmap = {}
    outlines = {}
    advances = {}
    for code, (width, rows) in sorted(font['glyphs'].items()):
        if code < 0x20:
            continue
        try:
            ch = bytes([code]).decode(codec)
        except UnicodeDecodeError:
            continue
        name = f'uni{ord(ch):04X}'
        if name in outlines:
            continue
        pen = TTGlyphPen(None)
        for y, row in enumerate(rows):
            x = 0
            while x < width:
                if not row[x]:
                    x += 1
                    continue
                start = x
                while x < width and row[x]:
                    x += 1
                # Rectangle for a horizontal run of lit pixels (clockwise)
                top = ascent - y * unit
                bottom = top - unit
                pen.moveTo((start * unit, bottom))
                pen.lineTo((start * unit, top))
                pen.lineTo((x * unit, top))
                pen.lineTo((x * unit, bottom))
                pen.closePath()
        order.append(name)
        cmap[ord(ch)] = name
        outlines[name] = pen.glyph()
        advances[name] = width * unit
    outlines['.notdef'] = TTGlyphPen(None).glyph()
    advances['.notdef'] = font['width'] * unit

    fb = FontBuilder(upm, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(outlines)
    fb.setupHorizontalMetrics({n: (advances[n], 0) for n in order})
    fb.setupHorizontalHeader(ascent=ascent, descent=-(upm - ascent))
    fb.setupOS2(sTypoAscender=ascent, sTypoDescender=-(upm - ascent), sTypoLineGap=0,
                usWinAscent=ascent, usWinDescent=upm - ascent)
    fb.setupNameTable({'familyName': family, 'styleName': 'Regular'})
    fb.setupPost(isFixedPitch=1)
    fb.font.flavor = 'woff'
    fb.save(out_path)
    print(f'{out_path}: {len(cmap)} glyphs, {font["width"]}x{h} cells, {codec}')


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    family = sys.argv[3] if len(sys.argv) > 3 else 'Angband'
    data = open(src, 'rb').read()
    fnt = next(fnt_resources(data))
    build(parse_fnt(fnt), dst, family)
