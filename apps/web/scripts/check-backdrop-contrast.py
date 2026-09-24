"""Check text contrast against every page backdrop defined in tokens.css.

Model (mirrors globals.css):
  scene   = backdrop image, scaled to cover a 1920x1080 viewport, Gaussian blur of
            --backdrop-blur, then --backdrop-tint composited on top (body::before/after).
  glass   = scene with --glass-blur applied (blur px and saturate()), then a surface
            colour (--color-surface-1, --color-surface-2, --glass-strong) composited on top.
For every text colour we compute the WCAG contrast ratio against every pixel and report
the 1st percentile, i.e. the ratio met by 99% of the viewport. For light text this equals
using the 99th-percentile background luminance.

Rules: on the bare scene only --color-text must reach 4.5:1 (others are info). On every
surface every listed text colour must reach 4.5:1. Exit code 1 on any required failure.

Approximations: compositing is done in sRGB like browsers do, Pillow's Gaussian radius is
treated as CSS's standard deviation, the page is assumed to be viewed at 1920x1080, and
panel edges/vignettes, anti-aliased glyphs and media-query token variants
(reduced transparency, no backdrop-filter, colourblind palette) are not modelled.

Usage: python scripts/check-backdrop-contrast.py   (from apps/web)
"""

import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

WEB = Path(__file__).resolve().parent.parent
TOKENS = WEB / "src" / "styles" / "tokens.css"
VIEWPORT = (1920, 1080)
MIN_RATIO = 4.5
PERCENTILE = 1  # contrast met by 99% of pixels

TEXT_VARS = ["--color-text", "--color-text-muted", "--color-accent", "--color-info",
             "--color-win", "--color-loss", "--team-own", "--team-enemy"]
SURFACE_VARS = ["--color-surface-1", "--color-surface-2", "--glass-strong"]


def top_level_rules(css):
    """Yield (selector, body) for rules at brace depth 0; nested @media/@supports rules are skipped."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    depth, start, sel_start = 0, 0, 0
    for i, ch in enumerate(css):
        if ch == "{":
            if depth == 0:
                selector, start = css[sel_start:i].strip(), i + 1
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                yield selector, css[start:i]
                sel_start = i + 1


def declarations(body):
    return {m[1]: m[2].strip() for m in re.finditer(r"(--[\w-]+)\s*:\s*([^;]+);", body)}


def resolve(vars_, name, seen=()):
    value = vars_[name]
    m = re.fullmatch(r"var\((--[\w-]+)\)", value)
    if m and m[1] not in seen:
        return resolve(vars_, m[1], seen + (name,))
    return value


def parse_colour(value):
    """Return (r, g, b, a) with rgb in 0..255 and a in 0..1."""
    value = value.strip()
    if value.startswith("#"):
        h = value[1:]
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a
    m = re.fullmatch(r"rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+%?))?\s*\)", value)
    if not m:
        raise ValueError(f"unsupported colour: {value}")
    a = m[4] or "1"
    a = float(a[:-1]) / 100 if a.endswith("%") else float(a)
    return float(m[1]), float(m[2]), float(m[3]), a


def px(value):
    m = re.search(r"([\d.]+)px", value)
    return float(m[1]) if m else 0.0


def luminance(rgb):
    """WCAG relative luminance of an array (..., 3) in 0..255."""
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return c @ np.array([0.2126, 0.7152, 0.0722])


def over(base, colour):
    r, g, b, a = colour
    return base * (1 - a) + np.array([r, g, b]) * a


def blur(rgb, radius):
    if radius <= 0:
        return rgb
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    return np.asarray(img.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float64)


def saturate(rgb, s):
    """CSS saturate() matrix."""
    m = np.array([
        [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ])
    return np.clip(rgb @ m.T, 0, 255)


def load_cover(path):
    img = Image.open(path).convert("RGB")
    vw, vh = VIEWPORT
    scale = max(vw / img.width, vh / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left, top = (img.width - vw) // 2, (img.height - vh) // 2
    return np.asarray(img.crop((left, top, left + vw, top + vh)), dtype=np.float64)


def worst_ratio(text, bg_lum):
    lt = luminance(np.array(text[:3], dtype=np.float64))
    hi, lo = np.maximum(lt, bg_lum), np.minimum(lt, bg_lum)
    return float(np.percentile((hi + 0.05) / (lo + 0.05), PERCENTILE))


def main():
    rules = list(top_level_rules(TOKENS.read_text(encoding="utf-8")))
    root = {}
    for sel, body in rules:
        if sel == ":root":
            root.update(declarations(body))
    variants = [("default", root)]
    for sel, body in rules:
        m = re.fullmatch(r':root\[data-backdrop=["\']?([\w-]+)["\']?\]', sel)
        if m:
            variants.append((m[1], {**root, **declarations(body)}))

    text_vars = TEXT_VARS + sorted(k for k in root if k.startswith("--tier-"))
    failures = 0
    for name, vars_ in variants:
        url = re.search(r'url\(["\']?([^"\')]+)', resolve(vars_, "--backdrop-image"))[1]
        image = WEB / "public" / url.lstrip("/")
        tint = parse_colour(resolve(vars_, "--backdrop-tint"))
        glass = resolve(vars_, "--glass-blur")
        sat = re.search(r"saturate\(([\d.]+)\)", glass)
        texts = {v: parse_colour(resolve(vars_, v)) for v in text_vars}

        scene = over(blur(load_cover(image), px(resolve(vars_, "--backdrop-blur"))), tint)
        glassed = blur(scene, px(glass))
        if sat:
            glassed = saturate(glassed, float(sat[1]))
        backgrounds = [("scene", luminance(scene))] + [
            (s, luminance(over(glassed, parse_colour(resolve(vars_, s))))) for s in SURFACE_VARS]

        print(f"\nBackdrop '{name}': {url}  (1% worst pixels excluded, need {MIN_RATIO}:1)")
        print(f"  {'text':<20}" + "".join(f"{b:>20}" for b, _ in backgrounds))
        for t, colour in texts.items():
            cells = []
            for bg, lum in backgrounds:
                ratio = worst_ratio(colour, lum)
                required = bg != "scene" or t == "--color-text"
                ok = ratio >= MIN_RATIO
                failures += required and not ok
                mark = "ok" if ok else ("FAIL" if required else "info")
                cells.append(f"{ratio:6.2f} {mark:<4}")
            print(f"  {t:<20}" + "".join(f"{c:>20}" for c in cells))

    print(f"\n{failures} required pair(s) below {MIN_RATIO}:1" if failures else "\nAll required pairs pass.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
