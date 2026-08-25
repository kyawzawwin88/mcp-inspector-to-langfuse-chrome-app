Import converted tools as **Langfuse Playground tools** (project-level, reusable with any prompt).

Langfuse has no public REST API for Playground tools, so this script upserts into the `llm_tools` table. You need DB access to your self-hosted Langfuse Postgres.

Put settings in `.env`:

```env
LANGFUSE_URL=http://192.168.10.1:3000
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/langfuse
# Optional if the API key can see more than one project:
# LANGFUSE_PROJECT_ID=...
```

Install the DB driver, then import:

```bash
pip install -r scripts/requirements.txt
python3 scripts/import_langfuse_tools.py testdata/converted_tools.json
```

After import, open **Playground → Tools** and attach the saved tools to any prompt run.
