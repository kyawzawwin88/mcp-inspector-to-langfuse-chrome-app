export type LangfuseTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: unknown;
  };
};

export type LangfuseConfig = {
  tools: LangfuseTool[];
  tool_choice: { type: "auto" };
};

export type ConvertResult =
  | { ok: true; config: LangfuseConfig }
  | { ok: false; error: string }
  | { ok: true; empty: true };

export function convertInspectorDump(input: string): ConvertResult {
  if (input.trim() === "") {
    return { ok: true, empty: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const mcpTools = extractMcpTools(parsed);
  if (mcpTools === null) {
    return { ok: false, error: "No tools/list result found" };
  }

  return {
    ok: true,
    config: {
      tools: mcpTools.flatMap((tool) => {
        const mapped = mapTool(tool);
        return mapped ? [mapped] : [];
      }),
      tool_choice: { type: "auto" },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSuccessfulToolsList(event: unknown): unknown[] | undefined {
  if (!isRecord(event)) {
    return undefined;
  }
  const message = event.message;
  if (!isRecord(message) || message.method !== "tools/list") {
    return undefined;
  }
  const response = event.response;
  if (!isRecord(response)) {
    return undefined;
  }
  const result = response.result;
  if (!isRecord(result) || !Array.isArray(result.tools)) {
    return undefined;
  }
  return result.tools;
}

function extractMcpTools(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) {
    const collected: unknown[] = [];
    let found = false;
    for (const event of parsed) {
      const tools = getSuccessfulToolsList(event);
      if (tools) {
        found = true;
        collected.push(...tools);
      }
    }
    return found ? collected : null;
  }

  if (isRecord(parsed)) {
    const fromEvent = getSuccessfulToolsList(parsed);
    if (fromEvent) {
      return fromEvent;
    }
    if (Array.isArray(parsed.tools)) {
      return parsed.tools;
    }
  }

  return null;
}

function stripTopLevelSchema(inputSchema: unknown): unknown {
  if (!isRecord(inputSchema)) {
    return {};
  }
  const { $schema: _schema, ...parameters } = inputSchema;
  return parameters;
}

function mapTool(tool: unknown): LangfuseTool | null {
  if (!isRecord(tool) || typeof tool.name !== "string" || tool.name.trim() === "") {
    return null;
  }

  const fn: LangfuseTool["function"] = {
    name: tool.name,
    ...(typeof tool.description === "string" ? { description: tool.description } : {}),
    parameters: stripTopLevelSchema(tool.inputSchema),
  };

  return { type: "function", function: fn };
}
