# Extension icons (Chrome Web Store)

Place these PNGs in this folder before running `npm run build`:

- `icon_16px.png`  → toolbar (16×16)
- `icon_32px.png`  → Windows / Retina toolbar (32×32)
- `icon_48px.png`  → extensions management page (48×48)
- `icon_128px.png` → Chrome Web Store listing (128×128)

The build copies them to `dist/icons/icon{16,32,48,128}.png` and packs `dist/` into a zip.
