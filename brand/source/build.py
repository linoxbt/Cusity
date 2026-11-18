"""Generate the Cusity brand kit as SVG (text outlined to paths)."""
import io, math, pathlib, sys
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = pathlib.Path(__file__).parent
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "out")
OUT.mkdir(parents=True, exist_ok=True)

# ---- palette -------------------------------------------------------------
INK = "#0B0D10"        # near-black background
INK_2 = "#161A20"      # background gradient top
PAPER = "#F4F5F2"      # off-white mark / text
ACCENT = "#C6FF3A"     # signal lime: the one accent
MUTED = "#8A93A0"      # secondary text on dark
INK_TEXT = "#0B0D10"

# ---- mark geometry (unit: 512 box) ------------------------------------------
CX = CY = 256
R = 128            # ring centreline radius
W = 68             # ring stroke width
GAP = 33           # half-angle of the opening, degrees (opening faces right)
DOT_R = 30         # the lit bit


def arc_path(cx, cy, r, w, gap_deg):
    """Filled outline of a thick ring arc with square ends, opening to the right."""
    a0, a1 = math.radians(gap_deg), math.radians(360 - gap_deg)
    ro, ri = r + w / 2, r - w / 2
    p = lambda rad, a: (cx + rad * math.cos(a), cy - rad * math.sin(a))
    o0, o1, i1, i0 = p(ro, a0), p(ro, a1), p(ri, a1), p(ri, a0)
    f = lambda pt: f"{pt[0]:.3f} {pt[1]:.3f}"
    return (f"M{f(o0)} A{ro} {ro} 0 1 0 {f(o1)} L{f(i1)} A{ri} {ri} 0 1 1 {f(i0)} Z")


def mark(scale=1.0, tx=0.0, ty=0.0, ring=PAPER, dot=ACCENT, w=W, dot_r=DOT_R, gap=GAP):
    t = f' transform="translate({tx:.3f} {ty:.3f}) scale({scale:.5f})"'
    return (f'<g{t}><path d="{arc_path(CX, CY, R, w, gap)}" fill="{ring}"/>'
            f'<circle cx="{CX + R}" cy="{CY}" r="{dot_r}" fill="{dot}"/></g>')


# ---- outlined text ---------------------------------------------------------
_fonts = {}


def font(path, wght):
    key = (path, wght)
    if key not in _fonts:
        tt = TTFont(path)
        inst = instantiateVariableFont(tt, {"wght": wght})
        buf = io.BytesIO(); inst.save(buf)
        data = buf.getvalue()
        _fonts[key] = (TTFont(io.BytesIO(data)), hb.Font(hb.Face(data)))
    return _fonts[key]


def text_path(s, path, wght, size, tracking_em=0.0):
    """Return (svg path d, width) for s at font size `size`, baseline at y=0."""
    tt, hbfont = font(path, wght)
    upem = tt["head"].unitsPerEm
    buf = hb.Buffer(); buf.add_str(s); buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": True})
    gs = tt.getGlyphSet(); order = tt.getGlyphOrder()
    k = size / upem; x = 0.0; d = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        pen = SVGPathPen(gs)
        gs[name].draw(TransformPen(pen, (k, 0, 0, -k, x + pos.x_offset * k, -pos.y_offset * k)))
        d.append(pen.getCommands())
        x += pos.x_advance * k + tracking_em * size
    return " ".join(d), x - tracking_em * size


SANS = str(HERE / "fonts/SpaceGrotesk.ttf")
MONO = str(HERE / "fonts/JetBrainsMono.ttf")


def word(s, x, y, size, fill, wght=600, track=-0.035, f=SANS):
    d, w = text_path(s, f, wght, size, track)
    return f'<path transform="translate({x:.2f} {y:.2f})" d="{d}" fill="{fill}"/>', w


def svg(w, h, body, defs=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<title>Cusity</title>{"<defs>" + defs + "</defs>" if defs else ""}{body}</svg>\n')


def bg_defs(id_, h):
    return (f'<linearGradient id="{id_}" x1="0" y1="0" x2="0" y2="{h}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{INK_2}"/><stop offset="1" stop-color="{INK}"/></linearGradient>')


def grid(w, h, step, opacity=0.05):
    lines = [f'<path d="M{x} 0V{h}" />' for x in range(step, w, step)]
    lines += [f'<path d="M0 {y}H{w}" />' for y in range(step, h, step)]
    return f'<g stroke="{PAPER}" stroke-opacity="{opacity}" stroke-width="1">{"".join(lines)}</g>'


def write(name, content):
    (OUT / name).write_text(content)


# 1. Mark, transparent, for dark backgrounds
write("cusity-mark.svg", svg(512, 512, mark()))
# 2. Mark, mono variants
write("cusity-mark-black.svg", svg(512, 512, mark(ring=INK, dot=INK)))
write("cusity-mark-white.svg", svg(512, 512, mark(ring=PAPER, dot=PAPER)))
# 3. App icon: rounded tile (form logo, favicon, site)
icon_body = (f'<rect width="512" height="512" rx="112" fill="url(#bg)"/>'
             f'<rect x="1" y="1" width="510" height="510" rx="111" fill="none" stroke="{PAPER}" stroke-opacity="0.07" stroke-width="2"/>'
             + mark(scale=0.78, tx=256 * 0.22, ty=256 * 0.22))
write("cusity-icon.svg", svg(512, 512, icon_body, bg_defs("bg", 512)))
# 3b. Favicon: heavier ring and bigger dot so it survives 16-32 px
fav_body = (f'<rect width="512" height="512" rx="112" fill="{INK}"/>'
            + mark(scale=0.86, tx=256 * 0.14 - 14, ty=256 * 0.14, w=96, dot_r=50, gap=38))
write("cusity-favicon.svg", svg(512, 512, fav_body))
# 4. Square full-bleed avatar (X / Telegram crop to a circle)
avatar_body = f'<rect width="512" height="512" fill="url(#bg)"/>' + mark(scale=0.62, tx=256 * 0.38, ty=256 * 0.38)
write("cusity-avatar.svg", svg(512, 512, avatar_body, bg_defs("bg", 512)))


# 5. Horizontal lockups
def lockup(text_fill, ring, dot, bg=None, tile=False):
    H = 160; m = H / 512 * (1.0 if not tile else 1.0)
    size = 132
    wd, ww = word("cusity", 0, 0, size, text_fill)
    gapx = 30
    if tile:
        mk = (f'<rect width="{H}" height="{H}" rx="{112 * m:.2f}" fill="{INK}"/>' + mark(scale=m * 0.78, tx=H * 0.11, ty=H * 0.11))
    else:
        mk = mark(scale=m, ring=ring, dot=dot)
    # optical baseline: centre x-height on the mark
    x_height = 0.49 * size
    base = H / 2 + x_height / 2
    W = H + gapx + ww + 8
    body = (f'<rect width="{W:.0f}" height="{H}" fill="{bg}"/>' if bg else "") + mk + \
        f'<g transform="translate({H + gapx} {base:.2f})">{wd}</g>'
    return svg(math.ceil(W), H, body)


write("cusity-logo-dark.svg", lockup(PAPER, PAPER, ACCENT))            # for dark backgrounds
write("cusity-logo-light.svg", lockup(INK_TEXT, INK, ACCENT, tile=True))  # for light backgrounds


# 6. X header 1500x500 and social card 1200x630
def banner(Wd, Ht, mark_px, word_size, tag_size, mono_size, cx_shift=0):
    t1, w1 = word("cusity", 0, 0, word_size, PAPER)
    t2, w2 = word("The bot filter you can check.", 0, 0, tag_size, MUTED, wght=500, track=-0.01)
    t3, w3 = word("64 bits in  ·  1 NAND circuit  ·  verdict on X Layer", 0, 0, mono_size, ACCENT, wght=500, track=0.0, f=MONO)
    gap = mark_px * 0.32
    block_w = mark_px + gap + max(w1, w2, w3)
    x0 = (Wd - block_w) / 2 + cx_shift
    y_mark = (Ht - mark_px) / 2
    s = mark_px / 512
    tx = x0 + mark_px + gap
    top = y_mark + mark_px * 0.08
    body = (f'<rect width="{Wd}" height="{Ht}" fill="url(#bg)"/>' + grid(Wd, Ht, 50, 0.035) +
            f'<rect width="{Wd}" height="{Ht}" fill="url(#vig)"/>' +
            mark(scale=s, tx=x0, ty=y_mark) +
            f'<g transform="translate({tx:.2f} {top + word_size * 0.78:.2f})">{t1}</g>' +
            f'<g transform="translate({tx + 4:.2f} {top + word_size * 0.78 + tag_size * 1.55:.2f})">{t2}</g>' +
            f'<g transform="translate({tx + 4:.2f} {top + word_size * 0.78 + tag_size * 1.55 + mono_size * 2.2:.2f})">{t3}</g>')
    defs = bg_defs("bg", Ht) + (f'<radialGradient id="vig" cx="0.5" cy="0.5" r="0.75">'
                                f'<stop offset="0.55" stop-color="{INK}" stop-opacity="0"/>'
                                f'<stop offset="1" stop-color="{INK}" stop-opacity="0.9"/></radialGradient>')
    return svg(Wd, Ht, body, defs)


write("x-header.svg", banner(1500, 500, 230, 112, 38, 20, cx_shift=60))
write("og-image.svg", banner(1200, 630, 250, 116, 38, 19))
print("wrote", sorted(p.name for p in OUT.iterdir()))
