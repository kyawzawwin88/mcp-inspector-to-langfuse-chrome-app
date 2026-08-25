#!/usr/bin/env python3
"""Import converted MCP tools as Langfuse Playground tools (project LlmTools).

The JSON file is the Chrome extension output:

  { "tools": [...], "tool_choice": { "type": "auto" } }

Langfuse has no public REST API for Playground tools. Those live in the
`llm_tools` table and are selected in Playground for any prompt. This script
upserts rows there (self-hosted / DB access required).

Credentials come from a project-root `.env` (or the process environment):

  LANGFUSE_URL=http://localhost:3000
  LANGFUSE_PUBLIC_KEY=pk-lf-...
  LANGFUSE_SECRET_KEY=sk-lf-...
  DATABASE_URL=postgresql://user:pass@host:5432/langfuse
  LANGFUSE_PROJECT_ID=...   # optional if the API key has exactly one project

Example:

  pip install -r scripts/requirements.txt
  python3 scripts/import_langfuse_tools.py converted.json
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    load_dotenv(PROJECT_ROOT / ".env")

    parser = argparse.ArgumentParser(
        description=(
            "Import converted tools JSON as Langfuse Playground tools "
            "(project-level LlmTools, not prompt config)."
        ),
    )
    parser.add_argument(
        "json_file",
        type=Path,
        help="Path to converted tools JSON from the Chrome extension",
    )
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("LANGFUSE_URL") or os.environ.get("LANGFUSE_BASE_URL"),
        help="Langfuse base URL (default: LANGFUSE_URL / LANGFUSE_BASE_URL from .env)",
    )
    parser.add_argument(
        "--public-key",
        default=os.environ.get("LANGFUSE_PUBLIC_KEY"),
        help="Langfuse public API key (default: LANGFUSE_PUBLIC_KEY from .env)",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("LANGFUSE_SECRET_KEY"),
        dest="secret_key",
        help="Langfuse secret API key (default: LANGFUSE_SECRET_KEY from .env)",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
        help="Postgres URL for the Langfuse DB (default: DATABASE_URL from .env)",
    )
    parser.add_argument(
        "--project-id",
        default=os.environ.get("LANGFUSE_PROJECT_ID"),
        help="Langfuse project id (default: LANGFUSE_PROJECT_ID, else auto-detect)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and resolve project, but do not write to the database",
    )
    args = parser.parse_args(argv)

    missing = []
    if not args.endpoint:
        missing.append("LANGFUSE_URL (or --endpoint)")
    if not args.public_key:
        missing.append("LANGFUSE_PUBLIC_KEY (or --public-key)")
    if not args.secret_key:
        missing.append("LANGFUSE_SECRET_KEY (or --api-key)")
    if not args.database_url and not args.dry_run:
        missing.append("DATABASE_URL (or --database-url)")
    if missing:
        parser.error("missing required settings: " + ", ".join(missing))

    return args


def load_converted_tools(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise FileNotFoundError(f"JSON file not found: {path}")

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON in {path}: {error.msg}") from error

    if isinstance(payload, list):
        tools = payload
    elif isinstance(payload, dict) and isinstance(payload.get("tools"), list):
        tools = payload["tools"]
    else:
        raise ValueError("Converted file must be a JSON object with a tools array")

    mapped: list[dict[str, Any]] = []
    for index, tool in enumerate(tools):
        if not isinstance(tool, dict) or tool.get("type") != "function":
            raise ValueError(f"tools[{index}] must be {{ type: 'function', function: {{...}} }}")
        function = tool.get("function")
        if not isinstance(function, dict):
            raise ValueError(f"tools[{index}].function must be an object")
        name = function.get("name")
        if not isinstance(name, str) or name.strip() == "":
            raise ValueError(f"tools[{index}].function.name must be a non-empty string")
        description = function.get("description")
        if description is None:
            description = ""
        elif not isinstance(description, str):
            raise ValueError(f"tools[{index}].function.description must be a string")
        parameters = function.get("parameters", {})
        if not isinstance(parameters, dict):
            raise ValueError(f"tools[{index}].function.parameters must be a JSON object")
        mapped.append(
            {
                "name": name,
                "description": description,
                "parameters": parameters,
            }
        )
    return mapped


def langfuse_request(
    endpoint: str,
    public_key: str,
    secret_key: str,
    method: str,
    path: str,
) -> tuple[int, Any]:
    url = f"{endpoint.rstrip('/')}{path}"
    token = base64.b64encode(f"{public_key}:{secret_key}".encode()).decode()
    request = urllib.request.Request(url, method=method)
    request.add_header("Authorization", f"Basic {token}")
    request.add_header("Accept", "application/json")

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            parsed: Any = json.loads(raw) if raw else {"message": error.reason}
        except json.JSONDecodeError:
            parsed = {"message": raw or error.reason}
        return error.code, parsed


def resolve_project_id(
    endpoint: str,
    public_key: str,
    secret_key: str,
    project_id: str | None,
) -> tuple[str, str | None]:
    if project_id:
        return project_id, None

    status, payload = langfuse_request(
        endpoint,
        public_key,
        secret_key,
        "GET",
        "/api/public/projects",
    )
    if status >= 400:
        raise RuntimeError(format_api_error("GET projects", status, payload))
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise RuntimeError("Langfuse GET projects returned an unexpected body")

    projects = payload["data"]
    if len(projects) == 0:
        raise RuntimeError("No Langfuse projects found for these API keys")
    if len(projects) > 1:
        names = ", ".join(
            f"{p.get('name')} ({p.get('id')})" for p in projects if isinstance(p, dict)
        )
        raise RuntimeError(
            "Multiple projects found; set LANGFUSE_PROJECT_ID or --project-id. "
            f"Projects: {names}"
        )
    project = projects[0]
    if not isinstance(project, dict) or not isinstance(project.get("id"), str):
        raise RuntimeError("Langfuse project entry is missing an id")
    return project["id"], project.get("name") if isinstance(project.get("name"), str) else None


def format_api_error(action: str, status: int, payload: Any) -> str:
    if isinstance(payload, dict):
        message = payload.get("message") or payload.get("error") or json.dumps(payload)
    else:
        message = str(payload)
    return f"{action} failed ({status}): {message}"


def upsert_llm_tools(database_url: str, project_id: str, tools: list[dict[str, Any]]) -> tuple[int, int]:
    try:
        import psycopg
    except ImportError as error:
        raise RuntimeError(
            "psycopg is required for Playground tool import. "
            "Run: pip install -r scripts/requirements.txt"
        ) from error

    created = 0
    updated = 0
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            for tool in tools:
                tool_id = f"cm{uuid.uuid4().hex[:22]}"
                cursor.execute(
                    """
                    INSERT INTO llm_tools (
                        id, created_at, updated_at, project_id, name, description, parameters
                    )
                    VALUES (
                        %s, NOW(), NOW(), %s, %s, %s, %s::jsonb
                    )
                    ON CONFLICT (project_id, name) DO UPDATE SET
                        description = EXCLUDED.description,
                        parameters = EXCLUDED.parameters,
                        updated_at = NOW()
                    RETURNING (xmax = 0) AS inserted
                    """,
                    (
                        tool_id,
                        project_id,
                        tool["name"],
                        tool["description"],
                        json.dumps(tool["parameters"]),
                    ),
                )
                row = cursor.fetchone()
                if row and row[0]:
                    created += 1
                else:
                    updated += 1
        connection.commit()
    return created, updated


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        tools = load_converted_tools(args.json_file)
        if not tools:
            print("No tools found in the JSON file.", file=sys.stderr)
            return 1

        project_id, project_name = resolve_project_id(
            args.endpoint,
            args.public_key,
            args.secret_key,
            args.project_id,
        )
        label = f"{project_name} ({project_id})" if project_name else project_id

        if args.dry_run:
            print(f"Dry run: would upsert {len(tools)} tool(s) into project {label}")
            for tool in tools:
                print(f"  - {tool['name']}")
            return 0

        created, updated = upsert_llm_tools(args.database_url, project_id, tools)
    except (FileNotFoundError, ValueError, RuntimeError, urllib.error.URLError) as error:
        print(error, file=sys.stderr)
        return 1

    print(
        f"Imported {len(tools)} Playground tool(s) into project {label}: "
        f"{created} created, {updated} updated."
    )
    print("Open Langfuse Playground → Tools to attach them to any prompt.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
