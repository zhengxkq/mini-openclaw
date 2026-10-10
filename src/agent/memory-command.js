import { AgentRunError } from "./run-policy.js";


export function handleMemoryCommand(text, context) {
  if (!/^\/memory(?:\s|$)/.test(text)) return null;
  try {
    const match = text.match(/^\/memory(?:\s+(\w+))?(?:\s+([\s\S]+))?$/);
    if (!match) throw new AgentRunError("INVALID_MEMORY_COMMAND", "命令格式错误。");
    const action = match[1] ?? "list";
    const args = match[2] ? JSON.parse(match[2]) : {};

    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new AgentRunError("INVALID_MEMORY_COMMAND", "参数必须是 JSON 对象。");
    }

    if (!["agent", "session"].includes(args.scope ?? "agent")) throw new AgentRunError("INVALID_MEMORY_SCOPE", "scope 只能是 agent 或 session。");
    if (args.scope === "session" && !context.sessionId) throw new AgentRunError("INVALID_MEMORY_SCOPE", "缺少当前会话编号。");
    const scope = args.scope === "session" ? `session:${context.sessionId}` : "agent:default";
    const { store } = context;
    let result;

    if (action === "status") result = { root: context.root, file: store?.filePath ?? "尚未接入", scope };
    else if (action === "list") result = { records: store.list(scope) };
    else if (action === "audit") result = { records: store.list(scope, true) };
    else if (action === "remember") result = store.remember({ scope, key: args.key, content: args.content,
      kind: args.kind ?? "preference", sourceId: `manual:${args.key}` });
    else if (action === "update") result = store.update(args.id, args.content, args.version, scope);
    else if (action === "delete") result = store.remove(args.id, args.version, scope);
    else if (action === "restore") result = store.restore(args.id, args.version, scope);
    else throw new AgentRunError("UNKNOWN_MEMORY_COMMAND", "没有这个记忆命令。");
    return JSON.stringify(result, null, 2);

  } catch (error) {
    return JSON.stringify({ error: error.code ?? "INVALID_MEMORY_COMMAND", message: error.message }, null, 2);
  }
}