# Cusity brand kit

**The mark:** a heavy "C" ring with one lit bit sitting in its opening. It reads as a C, as a
logic gate's output bubble, and as the single verdict bit that comes out of 64 input bits.
The style is dark, monochrome, with one accent colour, to match the product's design rules.

## What to use where

| Need | File |
|---|---|
| **Hackathon form logo (256×256, ≤10 MB)** | `png/cusity-logo-256.png` |
| X profile picture | `png/x-profile-400.png` |
| X header | `png/x-header-1500x500.png` |
| Telegram group or bot avatar | `png/telegram-avatar-640.png` |
| Website favicon | `png/favicon.ico` (16/32/48), plus `png/apple-touch-icon-180.png` |
| Link preview (`og:image`) for the DeWEB site | `png/og-image-1200x630.png` |
| Logo on dark slides or video | `svg/cusity-logo-dark.svg` / `png/cusity-logo-dark.png` |
| Logo on light backgrounds | `svg/cusity-logo-light.svg` / `png/cusity-logo-light.png` |
| App icon, any size | `svg/cusity-icon.svg` (or the 512 and 1024 PNGs) |
| Mark only, transparent | `svg/cusity-mark.svg`, `svg/cusity-mark-white.svg`, `svg/cusity-mark-black.svg` |

All SVGs have text converted to outlines, so they render the same everywhere without fonts installed.

## Colours

| Role | Hex |
|---|---|
| Ink (background) | `#0B0D10` → `#161A20` (top gradient) |
| Paper (mark, text) | `#F4F5F2` |
| Signal lime (the one accent; use it only for the dot, verdicts and highlights) | `#C6FF3A` |
| Muted text | `#8A93A0` |

## Type

- **Wordmark and headings:** Space Grotesk (SemiBold 600; body 500), tracking −3.5%. Always lowercase `cusity`.
- **Bits, addresses, gate IDs:** JetBrains Mono.
- Both are open-source under the SIL OFL 1.1, from Google Fonts.

## Rules

- Keep clear space around the mark of at least the dot's diameter.
- Don't recolour the ring, don't change the dot's position, and don't put the lime dot on a light background without the dark tile (use `cusity-logo-light`).
- Smallest size: 16 px for the favicon variant, 24 px for the regular mark.

## Rebuilding

`source/build.py` generates every SVG, and `source/render.cjs` renders the PNGs with Playwright's Chromium.
The fonts aren't committed. Download `SpaceGrotesk[wght].ttf` and `JetBrainsMono[wght].ttf` from
github.com/google/fonts into `source/fonts/`, then:

```bash
pip install fonttools uharfbuzz
python source/build.py svg && node source/render.cjs svg png
convert png/favicon-16.png png/favicon-32.png png/favicon-48.png png/favicon.ico
```
