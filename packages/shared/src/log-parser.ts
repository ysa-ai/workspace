import type { ParsedLogEntry } from "./types";

const MAX_TOOL_OUTPUT = 10000;

export function parseLogEntry(obj: any): ParsedLogEntry | null {
  if (obj.type === "system" && obj.subtype === "section") {
    return { type: "section", icon: "progress", text: obj.message || "" };
  }

  if (obj.type === "system" && obj.subtype === "progress") {
    return {
      type: "progress",
      icon: "progress",
      text: obj.message || "Working...",
    };
  }

  if (obj.type === "system" && obj.subtype === "status" && obj.status === "compacting") {
    return { type: "system", icon: "progress", text: "Compacting session context..." };
  }

  if (obj.type === "system" && obj.subtype === "compact_boundary") {
    const pre = obj.compact_metadata?.pre_tokens;
    const trigger = obj.compact_metadata?.trigger ?? "auto";
    const tokens = pre ? ` (${Math.round(pre / 1000)}K tokens)` : "";
    return { type: "system", icon: "init", text: `Session compacted [${trigger}]${tokens} — continuing` };
  }

  if (obj.type === "system" && obj.subtype === "init") {
    return {
      type: "system",
      icon: "init",
      text: `Session started — model: ${obj.model}, tools: ${obj.tools?.length || 0}`,
      session_id: obj.session_id,
    };
  }

  if (obj.type === "assistant" && obj.message?.content) {
    for (const block of obj.message.content) {
      if (block.type === "text" && block.text?.trim()) {
        return { type: "assistant", icon: "message", text: block.text.trim() };
      }
      if (block.type === "tool_use") {
        const input = block.input || {};
        let detail = "";
        if (block.name === "Read" || block.name === "Write" || block.name === "Edit") {
          detail = input.file_path || "";
        } else if (block.name === "Bash") {
          detail = input.command || "";
        } else if (block.name === "Glob") {
          detail = input.pattern || "";
        } else if (block.name === "Grep") {
          detail = input.pattern || "";
        } else {
          detail = JSON.stringify(input);
        }
        return {
          type: "tool_call",
          icon: "tool",
          tool: block.name,
          text: detail,
          tool_use_id: block.id,
        };
      }
    }
  }

  // Tool results — intermediate entries used by mergeToolOutputs
  if (obj.type === "user" && obj.message?.content) {
    for (const block of obj.message.content) {
      if (block.type === "tool_result" && block.tool_use_id) {
        let content = "";
        if (typeof block.content === "string") {
          content = block.content;
        } else if (Array.isArray(block.content)) {
          content = block.content
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("\n");
        }
        if (content.length > MAX_TOOL_OUTPUT) {
          content = "…" + content.slice(-MAX_TOOL_OUTPUT);
        }
        return {
          type: "raw",
          icon: "tool_result",
          text: content,
          tool_use_id: block.tool_use_id,
        };
      }
    }
  }

  if (obj.type === "result") {
    return {
      type: "result",
      icon: obj.subtype === "success" ? "success" : "error",
      text:
        obj.result?.slice(0, 300) ||
        `${obj.subtype} — ${obj.num_turns || "?"} turns, cost: $${obj.total_cost_usd?.toFixed(4) || "?"}`,
      cost: obj.total_cost_usd,
      turns: obj.num_turns,
    };
  }

  return null;
}

export function mergeToolOutputs(entries: ParsedLogEntry[]): ParsedLogEntry[] {
  const outputMap = new Map<string, string>();
  for (const e of entries) {
    if (e.type === "raw" && e.icon === "tool_result" && e.tool_use_id) {
      outputMap.set(e.tool_use_id, e.text);
    }
  }

  return entries
    .filter((e) => !(e.type === "raw" && e.icon === "tool_result"))
    .map((e) => {
      if (e.type === "tool_call" && e.tool_use_id && outputMap.has(e.tool_use_id)) {
        return { ...e, output: outputMap.get(e.tool_use_id) };
      }
      return e;
    });
}
