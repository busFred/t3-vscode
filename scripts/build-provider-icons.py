"""Regenerate the native provider icon font. Optional tool: fonttools==4.60.1.

SVG source marks retain vendor/LICENSE.t3code; generated fonts are shipped so
normal pnpm build/package needs no Python packages.
"""
from pathlib import Path
import xml.etree.ElementTree as ET
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import SVGPath

root = Path(__file__).resolve().parent.parent
brands = ["codex", "claude", "kimi", "other"]
builder = FontBuilder(1000, isTTF=True)
builder.setupGlyphOrder([".notdef"] + brands)
glyphs = {".notdef": TTGlyphPen(None).glyph()}
for brand in brands:
    svg = (root / "resources" / f"provider-{brand}.svg").read_bytes()
    x, y, width, height = map(float, ET.fromstring(svg).attrib["viewBox"].split())
    pen = TTGlyphPen(None)
    transform = (900 / width, 0, 0, -900 / height, 50 - x * 900 / width, 950 + y * 900 / height)
    SVGPath.fromstring(svg).draw(TransformPen(Cu2QuPen(pen, max_err=0.7, reverse_direction=True), transform))
    glyphs[brand] = pen.glyph()
builder.setupCharacterMap({0xE001 + index: brand for index, brand in enumerate(brands)})
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics({brand: (1000, 0) for brand in [".notdef"] + brands})
builder.setupHorizontalHeader(ascent=1000, descent=0)
builder.setupNameTable({"familyName": "T3 VSCode Providers", "styleName": "Regular", "uniqueFontIdentifier": "T3VSCodeProviders-1", "fullName": "T3 VSCode Providers", "psName": "T3VSCodeProviders"})
builder.setupOS2(sTypoAscender=1000, sTypoDescender=0, usWinAscent=1000, usWinDescent=0)
builder.setupPost()
builder.font.flavor = "woff"
builder.font["head"].created = builder.font["head"].modified = 3874089600
builder.save(root / "resources" / "provider-icons.woff")
