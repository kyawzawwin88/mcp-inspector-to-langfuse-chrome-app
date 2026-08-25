import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { convertInspectorDump } from "./convert.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "testdata",
  "inspector-protocol-sample.json",
);
const sampleDump = readFileSync(fixturePath, "utf8");

function toolsListEvent(tools: unknown[]) {
  return {
    message: { method: "tools/list", jsonrpc: "2.0", id: 1 },
    response: { jsonrpc: "2.0", id: 1, result: { tools } },
  };
}

function mcpTool(overrides: Record<string, unknown> = {}) {
  return {
    name: "search_workflows",
    description: "Search for workflows with optional filters. Returns a preview of each workflow.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
      $schema: "http://json-schema.org/draft-07/schema#",
    },
    annotations: { title: "Search Workflows" },
    execution: { taskSupport: "forbidden" },
    outputSchema: { type: "object" },
    extraIgnored: true,
    ...overrides,
  };
}

function parseErrorMessage(input: string): string {
  try {
    JSON.parse(input);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected JSON.parse to fail");
}

describe("convertInspectorDump", () => {
  it("converts a sample Inspector dump with 33 tools", () => {
    const result = convertInspectorDump(sampleDump);
    assert.equal(result.ok, true);
    assert.ok(result.ok && !("empty" in result));
    if (!result.ok || "empty" in result) {
      return;
    }

    assert.equal(result.config.tools.length, 33);
    assert.deepEqual(result.config.tool_choice, { type: "auto" });
    assert.ok(result.config.tools.every((tool) => tool.type === "function"));

    const parsed = JSON.parse(sampleDump) as Array<{
      message?: { method?: string };
      response?: { result?: { tools?: Array<Record<string, unknown>> } };
    }>;
    const rawTools =
      parsed.find((event) => event.message?.method === "tools/list")?.response?.result?.tools ?? [];
    const search = rawTools.find((tool) => tool.name === "search_workflows");
    assert.ok(search);
    const { $schema: _schema, ...expectedParameters } = search.inputSchema as Record<
      string,
      unknown
    >;

    const mapped = result.config.tools.find((tool) => tool.function.name === "search_workflows");
    assert.ok(mapped);
    assert.equal(
      mapped.function.description,
      "Search for workflows with optional filters. Returns a preview of each workflow.",
    );
    assert.deepEqual(mapped.function.parameters, expectedParameters);
    assert.equal(
      Object.prototype.hasOwnProperty.call(mapped.function.parameters as object, "$schema"),
      false,
    );
    assert.equal("annotations" in mapped, false);
    assert.equal("execution" in mapped, false);
    assert.equal("outputSchema" in mapped, false);
    assert.equal("annotations" in mapped.function, false);
    assert.equal("execution" in mapped.function, false);
    assert.equal("outputSchema" in mapped.function, false);
  });

  it("returns empty output for an empty left pane", () => {
    assert.deepEqual(convertInspectorDump(""), { ok: true, empty: true });
  });

  it("returns empty output for whitespace-only input", () => {
    assert.deepEqual(convertInspectorDump("  \n\t  "), { ok: true, empty: true });
  });

  it("surfaces the JSON.parse message for invalid JSON", () => {
    const input = "{";
    const result = convertInspectorDump(input);
    assert.deepEqual(result, { ok: false, error: parseErrorMessage(input) });
  });

  it("reports when valid JSON has no tools/list result", () => {
    const result = convertInspectorDump(
      JSON.stringify([{ message: { method: "initialize" }, response: { result: {} } }]),
    );
    assert.deepEqual(result, { ok: false, error: "No tools/list result found" });
  });

  it("emits empty tools plus tool_choice for an empty tools array", () => {
    const result = convertInspectorDump(JSON.stringify([toolsListEvent([])]));
    assert.deepEqual(result, {
      ok: true,
      config: { tools: [], tool_choice: { type: "auto" } },
    });
  });

  it("concatenates tools from multiple successful tools/list events in dump order", () => {
    const result = convertInspectorDump(
      JSON.stringify([
        toolsListEvent([mcpTool({ name: "first" })]),
        { message: { method: "initialize" }, response: { result: {} } },
        toolsListEvent([mcpTool({ name: "second" }), mcpTool({ name: "third" })]),
      ]),
    );
    assert.equal(result.ok, true);
    assert.ok(result.ok && !("empty" in result));
    if (!result.ok || "empty" in result) {
      return;
    }
    assert.deepEqual(
      result.config.tools.map((tool) => tool.function.name),
      ["first", "second", "third"],
    );
  });

  it("treats a tools/list RPC error as missing unless another event has tools", () => {
    const errorEvent = {
      message: { method: "tools/list" },
      response: { error: { code: -32603, message: "failed" } },
    };
    assert.deepEqual(convertInspectorDump(JSON.stringify([errorEvent])), {
      ok: false,
      error: "No tools/list result found",
    });

    const mixed = convertInspectorDump(
      JSON.stringify([errorEvent, toolsListEvent([mcpTool({ name: "kept" })])]),
    );
    assert.equal(mixed.ok, true);
    assert.ok(mixed.ok && !("empty" in mixed));
    if (!mixed.ok || "empty" in mixed) {
      return;
    }
    assert.deepEqual(
      mixed.config.tools.map((tool) => tool.function.name),
      ["kept"],
    );
  });

  it("converts a bare { tools: [...] } payload", () => {
    const result = convertInspectorDump(JSON.stringify({ tools: [mcpTool()] }));
    assert.equal(result.ok, true);
    assert.ok(result.ok && !("empty" in result));
    if (!result.ok || "empty" in result) {
      return;
    }
    assert.equal(result.config.tools.length, 1);
    assert.equal(result.config.tools[0]?.function.name, "search_workflows");
    assert.deepEqual(result.config.tool_choice, { type: "auto" });
  });

  it("converts a single tools/list event object", () => {
    const result = convertInspectorDump(JSON.stringify(toolsListEvent([mcpTool({ name: "solo" })])));
    assert.equal(result.ok, true);
    assert.ok(result.ok && !("empty" in result));
    if (!result.ok || "empty" in result) {
      return;
    }
    assert.equal(result.config.tools[0]?.function.name, "solo");
  });

  it("omits description when missing, skips nameless/whitespace names, and defaults non-object schemas", () => {
    const result = convertInspectorDump(
      JSON.stringify({
        tools: [
          {
            description: "no name",
            inputSchema: { type: "object" },
          },
          {
            name: "   ",
            inputSchema: { type: "object" },
          },
          {
            name: "named_only",
            inputSchema: { type: "object", $schema: "http://json-schema.org/draft-07/schema#" },
          },
          {
            name: "bad_schema",
            inputSchema: ["not", "an", "object"],
          },
        ],
      }),
    );
    assert.equal(result.ok, true);
    assert.ok(result.ok && !("empty" in result));
    if (!result.ok || "empty" in result) {
      return;
    }
    assert.equal(result.config.tools.length, 2);
    assert.deepEqual(result.config.tools[0], {
      type: "function",
      function: {
        name: "named_only",
        parameters: { type: "object" },
      },
    });
    assert.equal("description" in result.config.tools[0].function, false);
    assert.deepEqual(result.config.tools[1], {
      type: "function",
      function: {
        name: "bad_schema",
        parameters: {},
      },
    });
  });

  it("drops MCP-only fields and top-level $schema on the mapped function", () => {
    const result = convertInspectorDump(JSON.stringify({ tools: [mcpTool()] }));
    assert.equal(result.ok, true);
    assert.ok(result.ok && !("empty" in result));
    if (!result.ok || "empty" in result) {
      return;
    }
    const serialized = JSON.stringify(result.config.tools[0]);
    assert.equal(serialized.includes("annotations"), false);
    assert.equal(serialized.includes("execution"), false);
    assert.equal(serialized.includes("outputSchema"), false);
    assert.equal(serialized.includes("extraIgnored"), false);
    assert.equal(serialized.includes("$schema"), false);
    assert.deepEqual(result.config.tools[0]?.function.parameters, {
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });
});
