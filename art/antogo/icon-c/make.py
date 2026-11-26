"""The app icon, option C "Blue, refreshed" (chosen by Todd, 25 Nov 2026): the brand blues, brighter, with a white
rider. Draws every size and shape each version needs, from the approved rider shapes in paths.json.
Run from the project folder: python3 art/antogo/icon-c/make.py"""
import json, os, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
P = json.load(open(os.path.join(HERE, 'paths.json')))
CX, CY = 215, 74  # centre of the rider's box (x 100-330, y 15-133)
REAR, BODY, HEAD = '#3FE0FF', '#FFFFFF', '#FD8C23'
GRAD = '<linearGradient id="gc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A2552"/><stop offset="1" stop-color="#0575F6"/></linearGradient>'


def rider(scale, dy=20, thick=3.0):
    tx, ty = 512 - CX * scale, 512 + dy - CY * scale
    st = lambda c: f'stroke="{c}" stroke-width="{thick}" stroke-linejoin="round"'
    h = P['HEAD']
    return (f'<g transform="translate({tx:.2f},{ty:.2f}) scale({scale})">'
            f'<path d="{P["REAR"]}" fill="{REAR}" {st(REAR)}/><path d="{P["BACK"]}" fill="{BODY}" {st(BODY)}/>'
            f'<path d="{P["FRONT"]}" fill="{BODY}" {st(BODY)}/><circle cx="{h["cx"]}" cy="{h["cy"]}" r="{h["r"] + thick * 0.6}" fill="{HEAD}"/></g>')


def tile(rx, scale=3.95, inset=0, thick=3.0):
    """A 1024 tile. rx: corner rounding (0 for the shapes a system rounds itself). inset: clear margin around the tile (a Mac icon sits inside its square)."""
    size = 1024 - 2 * inset
    k = size / 1024
    inner = f'<rect width="1024" height="1024" rx="{rx}" fill="url(#gc)"/>' + rider(scale, thick=thick)
    clip = f'<clipPath id="sq"><rect width="1024" height="1024" rx="{rx}"/></clipPath>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs>{clip}{GRAD}</defs>'
            f'<g transform="translate({inset},{inset}) scale({k})"><g clip-path="url(#sq)">{inner}</g></g></svg>')


def png(svg, path, size, flat=False):
    with tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False) as f:
        f.write(svg)
    js = (f"const sharp=require('sharp');let s=sharp({json.dumps(f.name)},{{density:300}}).resize({size},{size});"
          + ("s=s.flatten({background:'#0A2552'}).removeAlpha();" if flat else '')
          + f"s.png().toFile({json.dumps(path)}).then(()=>console.log('made',{json.dumps(os.path.relpath(path, ROOT))}))")
    subprocess.run(['node', '-e', js], cwd=ROOT, check=True)
    os.unlink(f.name)


rounded = tile(230)                      # browsers and "any" icons: the tile with its own rounded corners
square = tile(0)                         # iPhone, iPad and the home-screen icon: the system rounds these itself
maskable = tile(0, scale=3.05)           # Android's adaptive shape: the rider well inside the safe middle
mac = tile(230, inset=100)               # the Mac app: a rounded tile inside its square, as Mac icons sit
small = tile(230, scale=3.95, thick=5)   # 32 px: a slightly heavier line so the rider holds together

pub = os.path.join(ROOT, 'public')
open(os.path.join(pub, 'icon.svg'), 'w').write(rounded)
open(os.path.join(pub, 'favicon.svg'), 'w').write(small)
open(os.path.join(HERE, 'icon-c.svg'), 'w').write(rounded)
png(rounded, os.path.join(pub, 'icon-512.png'), 512)
png(rounded, os.path.join(pub, 'icon-192.png'), 192)
png(small, os.path.join(pub, 'favicon-32.png'), 32)
png(maskable, os.path.join(pub, 'icon-maskable-512.png'), 512, flat=True)
png(square, os.path.join(pub, 'apple-touch-icon.png'), 180, flat=True)
png(square, os.path.join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'), 1024, flat=True)
png(mac, os.path.join(ROOT, 'desktop/icon.png'), 1024)
