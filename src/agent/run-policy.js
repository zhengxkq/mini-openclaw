export class AgentRunError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentRunError";
    this.code = code;
  }
}

export function prepareToolCalls(toolCalls, definitions) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    throw new AgentRunError("INVALID_TOOL_CALL", "模型没有提供完整工具请求，任务已停止。");
  }
  const allowed = new Map(definitions.map(item => [item.function.name, item.function]));
  const ids = new Set();

  return toolCalls.map(toolCall => {
    if (toolCall?.type !== "function" || typeof toolCall.id !== "string" ||
        !toolCall.id.trim() || ids.has(toolCall.id)) {
      throw new AgentRunError("INVALID_TOOL_CALL", "工具请求编号缺失或重复，任务已停止。");
    }
    ids.add(toolCall.id);
    const definition = allowed.get(toolCall.function?.name);
    if (!definition) {
      throw new AgentRunError("TOOL_NOT_ALLOWED", "模型请求了未开放的工具，已拒绝执行。");
    }

    let args;
    try {
      if (typeof toolCall.function.arguments !== "string") throw new Error();
      args = JSON.parse(toolCall.function.arguments);
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error();
    } catch {
      throw new AgentRunError("INVALID_TOOL_ARGUMENTS", `${definition.name} 的参数不是完整 JSON 对象，已拒绝执行。`);
    }

    const schema = definition.parameters;
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(args, key)) {
        throw new AgentRunError("INVALID_TOOL_ARGUMENTS", `${definition.name} 缺少参数 ${key}，已拒绝执行。`);
      }
    }
    // 当前工具定义只有平面的 string / number 属性；这里只实现这一部分。
    for (const [key, rule] of Object.entries(schema.properties ?? {})) {
      if (!Object.hasOwn(args, key)) continue;
      if (!["string", "number"].includes(rule.type)) {
        throw new AgentRunError("INVALID_TOOL_ARGUMENTS", `${definition.name} 的参数规则尚未支持，已停止执行。`);
      }
      if (typeof args[key] !== rule.type || (rule.type === "number" && !Number.isFinite(args[key]))) {
        throw new AgentRunError("INVALID_TOOL_ARGUMENTS", `${definition.name} 的 ${key} 必须是 ${rule.type}，已拒绝执行。`);
      }
    }
    return { toolCall, args };
  });
}

export function assertToolResult(content, toolName) {
  if (typeof content !== "string") {
    throw new AgentRunError("INVALID_TOOL_RESULT", `${toolName} 返回格式不正确，任务已停止。`);
  }
  let data;
  try { data = JSON.parse(content); } catch { return; }
  if (data && typeof data === "object" && Object.hasOwn(data, "error")) {
    throw new AgentRunError("TOOL_FAILED", `${toolName} 执行失败：${String(data.error).slice(0, 160)}`);
  }
}