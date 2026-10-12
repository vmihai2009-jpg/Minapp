#!/usr/bin/env python3
"""Builds the two clock fonts the macOS desktop widget uses so its live timer has the player's exact LED digits.
Input: tools/widget-font/d0.png .. d9.png (the 9x13 digit sprites of the skin, lit segments green, unlit segments dark grey).
Output (needs `pip install fonttools pillow`): mac/widget/Extension/Fonts/MinappLED.ttf (lit segments) and
MinappLEDGhost.ttf (unlit segments; draw it dimmed behind the lit one). 1 sprite pixel = 100 font units, 13 px = 1 em.
Advance: digit 12 px (9 + 3 gap, as in the player), colon 6 px."""
import os
from PIL import Image
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'mac', 'widget', 'Extension', 'Fonts')
PX = 100

def is_lit(p): return p[3] > 0 and p[1] > 150 and p[0] < 120
def is_ghost(p): return p[3] > 0 and not is_lit(p) and (p[0] + p[1] + p[2]) > 30

def glyph(pixels, h=13):
    pen = TTGlyphPen(None)
    for (x, y) in pixels:                      # y counts from the top of the sprite
        x0, x1 = x * PX, (x + 1) * PX
        y1, y0 = (h - y) * PX, (h - y - 1) * PX
        pen.moveTo((x0, y0)); pen.lineTo((x0, y1)); pen.lineTo((x1, y1)); pen.lineTo((x1, y0)); pen.closePath()
    return pen.glyph()

def build(name, test):
    order = ['.notdef', 'space', 'colon'] + [f'd{n}' for n in range(10)]
    glyphs = {'.notdef': TTGlyphPen(None).glyph(), 'space': TTGlyphPen(None).glyph()}
    metrics = {'.notdef': (600, 0), 'space': (600, 0)}
    # colon: two 2x2 dots inside its 6 px advance
    colon = [(3, 4), (4, 4), (3, 5), (4, 5), (3, 9), (4, 9), (3, 10), (4, 10)]
    glyphs['colon'] = glyph(colon) if test is is_lit else TTGlyphPen(None).glyph()
    metrics['colon'] = (6 * PX, 0)
    cmap = {ord(' '): 'space', ord(':'): 'colon'}
    for n in range(10):
        im = Image.open(os.path.join(HERE, 'widget-font', f'd{n}.png')).convert('RGBA')
        px = [(x, y) for y in range(im.height) for x in range(im.width) if test(im.getpixel((x, y)))]
        glyphs[f'd{n}'] = glyph(px); metrics[f'd{n}'] = (12 * PX, 0); cmap[ord(str(n))] = f'd{n}'
    fb = FontBuilder(1300, isTTF=True)
    fb.setupGlyphOrder(order); fb.setupCharacterMap(cmap); fb.setupGlyf(glyphs); fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=1300, descent=0)
    fb.setupNameTable({'familyName': name, 'styleName': 'Regular'})
    fb.setupOS2(sTypoAscender=1300, sTypoDescender=0, usWinAscent=1300, usWinDescent=0)
    fb.setupPost()
    os.makedirs(OUT, exist_ok=True)
    fb.save(os.path.join(OUT, name + '.ttf'))

build('MinappLED', is_lit)
build('MinappLEDGhost', is_ghost)
print('fonts written to', os.path.normpath(OUT))
