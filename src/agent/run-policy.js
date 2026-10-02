export class AgentRunError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentRunError";
    this.code = code;
  }
}

export function prepareToolCalls(calls, definitions) {
  if (!Array.isArray(calls) || calls.length === 0) {
    throw new AgentRunError("INVALID_TOOL_CALL", "没有完整的工具请求。");
  }
  const ids = new Set();
  return calls.map(call => {
    if (call?.type !== "function" || typeof call.id !== "string" || !call.id.trim() || ids.has(call.id)) {
      throw new AgentRunError("INVALID_TOOL_CALL", "工具请求编号缺失或重复。");
    }
    ids.add(call.id);
    const definition = definitions.find(item => item.function.name === call.function?.name);
    if (!definition) throw new AgentRunError("TOOL_NOT_ALLOWED", "这个工具没有开放。");
    let args;
    try {
      if (typeof call.function.arguments !== "string") throw new Error();
      args = JSON.parse(call.function.arguments);
    } catch {
      throw new AgentRunError("INVALID_TOOL_ARGUMENTS", "参数不是完整的 JSON 字符串。");
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new AgentRunError("INVALID_TOOL_ARGUMENTS", "参数必须是一个对象。");
    }
    for (const key of definition.function.parameters.required ?? []) {
      if (!Object.hasOwn(args, key)) throw new AgentRunError("INVALID_TOOL_ARGUMENTS", `缺少 ${key}。`);
    }
    for (const [key, rule] of Object.entries(definition.function.parameters.properties ?? {})) {
      if (!Object.hasOwn(args, key)) continue;
      if (!["string", "number"].includes(rule.type) || typeof args[key] !== rule.type ||
          (rule.type === "number" && !Number.isFinite(args[key]))) {
        throw new AgentRunError("INVALID_TOOL_ARGUMENTS", `${key} 必须符合 ${rule.type} 类型。`);
      }
    }
    return { toolCall: call, args };
  });
}