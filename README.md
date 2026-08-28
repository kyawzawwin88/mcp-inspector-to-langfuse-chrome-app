# MCP Inspector → Langfuse Chrome Extension

Convert MCP Inspector protocol dumps into Langfuse Playground tools, then import them with the Python script.

Available in chrome app store: [https://chromewebstore.google.com/detail/jhdndobonogpngfmenhggjidmlpjpglg?utm_source=item-share-cb]

## Chrome extension

### Icons

Put PNGs in `assets/icons/` before building:

- `icon_16px.png`
- `icon_32px.png`
- `icon_48px.png`
- `icon_128px.png`

### Build

```bash
npm install
npm run build
```

This compiles TypeScript, copies HTML/CSS/manifest/icons into `dist/`, and creates:

`mcp-inspector-to-langfuse-v1.0.0.zip`

### Load unpacked (dev)

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Load unpacked → select `dist/`

### Chrome Web Store

Upload `mcp-inspector-to-langfuse-v1.0.0.zip` (manifest at zip root).

## Import tools into Langfuse Playground

Import converted tools as **project-level Playground tools** (reusable with any prompt).

Langfuse has no public REST API for Playground tools, so the script upserts into the `llm_tools` table. You need DB access to your self-hosted Langfuse Postgres.

Put settings in `.env`:

```env
LANGFUSE_URL=http://192.168.10.1:3000
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/langfuse
# Optional if the API key can see more than one project:
# LANGFUSE_PROJECT_ID=...
```

```bash
pip install -r scripts/requirements.txt
python3 scripts/import_langfuse_tools.py testdata/converted_tools.json
```

After import, open **Playground → Tools** and attach the saved tools to any prompt run.

## Support

If you find this extension useful, consider [buying me a coffee](https://buymeacoffee.com/kyawzawwin)! ☕
