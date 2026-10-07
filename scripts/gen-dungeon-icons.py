# Generates the small Mythic+ dungeon icons in public/dungeons/<mapId>.webp (64x64).
#
# Source art is Tauri's challenge-mode banner for each dungeon (1277x584,
# https://tauriwow.com/sys/img/dungeon/<instanceId>.jpg). Each icon is a hand-picked
# square crop around the dungeon's signature feature (the serpent for Eye of Azshara,
# the raven crest for Black Rook Hold, the Warden for Vault, ...), downscaled and
# lightly brightened/sharpened so it still reads at ~26px.
#
# Run from the repo root:  python scripts/gen-dungeon-icons.py
# Needs Pillow (pip install pillow). To add a dungeon, add its armory map id to
# src/lib/mplusDungeons.js and a crop entry below.
import io
import os
import urllib.request

from PIL import Image, ImageEnhance, ImageFilter

SRC = 'https://tauriwow.com/sys/img/dungeon/{}.jpg'
OUT = os.path.join('public', 'dungeons')
SIZE = 64

# armory map id -> (banner instance id, crop center x, crop center y (fractions), side px)
CROPS = {
    197: (1456, 0.30, 0.42, 420),  # Eye of Azshara — the serpent
    198: (1466, 0.42, 0.62, 400),  # Darkheart Thicket — corrupted portal
    199: (1501, 0.34, 0.30, 330),  # Black Rook Hold — raven crest
    200: (1477, 0.37, 0.38, 380),  # Halls of Valor — winged statue
    206: (1458, 0.46, 0.62, 400),  # Neltharion's Lair — lava
    207: (1493, 0.13, 0.38, 380),  # Vault of the Wardens — the Warden
    208: (1492, 0.42, 0.40, 420),  # Maw of Souls — drake skull
    209: (1516, 0.50, 0.33, 360),  # The Arcway — arcane orb
    210: (1571, 0.77, 0.50, 420),  # Court of Stars — nightborne palace
}


# Wide banners for the best-runs table: the dungeon cell's whole background (fixed size,
# so every name sits on the same strip whatever its length). The page fades each strip
# out to the right, so the crop puts the dungeon's signature feature on the LEFT.
# armory map id -> (banner instance id, crop start x, crop width, center y (fractions), flip)
BANNER_W, BANNER_H = 864, 192  # 2x the on-page size
BANNERS = {
    197: (1456, 0.00, 1.00, 0.40, False),  # Eye of Azshara — serpent + storm
    198: (1466, 0.14, 0.80, 0.56, False),  # Darkheart Thicket — corrupted portal
    199: (1501, 0.12, 0.80, 0.28, False),  # Black Rook Hold — raven crest
    200: (1477, 0.14, 0.80, 0.40, False),  # Halls of Valor — winged statue
    206: (1458, 0.12, 0.80, 0.60, False),  # Neltharion's Lair — lava river
    207: (1493, 0.00, 0.80, 0.30, False),  # Vault of the Wardens — the Warden
    208: (1492, 0.22, 0.78, 0.40, False),  # Maw of Souls — drake skull
    209: (1516, 0.28, 0.72, 0.32, False),  # The Arcway — arcane orbs
    210: (1571, 0.20, 0.80, 0.45, True),   # Court of Stars — palace, mirrored onto the left
}


def fetch(src):
    req = urllib.request.Request(SRC.format(src), headers={'User-Agent': 'Mozilla/5.0'})
    return Image.open(io.BytesIO(urllib.request.urlopen(req).read())).convert('RGB')


def make_banners():
    out = os.path.join(OUT, 'banner')
    os.makedirs(out, exist_ok=True)
    for map_id, (src, x0f, wf, cy, flip) in BANNERS.items():
        im = fetch(src)
        w, h = im.size
        cw = round(w * wf)
        x0 = min(max(round(w * x0f), 0), w - cw)
        ch = round(cw * BANNER_H / BANNER_W)
        y0 = min(max(int(cy * h - ch / 2), 0), h - ch)
        b = im.crop((x0, y0, x0 + cw, y0 + ch)).resize((BANNER_W, BANNER_H), Image.LANCZOS)
        if flip:
            b = b.transpose(Image.FLIP_LEFT_RIGHT)
        b = ImageEnhance.Contrast(b).enhance(1.08)
        path = os.path.join(out, f'{map_id}.webp')
        b.save(path, 'WEBP', quality=82, method=6)
        print(f'{path}  ({os.path.getsize(path)} bytes)')


def main():
    os.makedirs(OUT, exist_ok=True)
    for map_id, (src, cx, cy, side) in CROPS.items():
        im = fetch(src)
        w, h = im.size
        x0 = min(max(int(cx * w - side / 2), 0), w - side)
        y0 = min(max(int(cy * h - side / 2), 0), h - side)
        ic = im.crop((x0, y0, x0 + side, y0 + side)).resize((SIZE, SIZE), Image.LANCZOS)
        ic = ImageEnhance.Brightness(ic).enhance(1.15)
        ic = ImageEnhance.Contrast(ic).enhance(1.12)
        ic = ImageEnhance.Color(ic).enhance(1.15)
        ic = ic.filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=2))
        path = os.path.join(OUT, f'{map_id}.webp')
        ic.save(path, 'WEBP', quality=88, method=6)
        print(f'{path}  ({os.path.getsize(path)} bytes)')
    make_banners()


if __name__ == '__main__':
    main()
