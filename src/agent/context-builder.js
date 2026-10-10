import { AgentRunError } from "./run-policy.js";

export function inputBytes(messages, tools = []) {
  return Buffer.byteLength(JSON.stringify({ messages, tools }), "utf8");
}


function assertToolPairs(messages) {
  const pending = new Set();
  for (const message of messages) {
    if (message.role === "tool") {
      if (!pending.delete(message.tool_call_id)) throw new AgentRunError("INVALID_CONTEXT", "工具结果找不到对应请求");
      continue;
    }

    if (pending.size) throw new AgentRunError("INVALID_CONTEXT", "工具结果还没配齐就出现了其他消息");
    for (const call of message.tool_calls ?? []) {
      if (typeof call.id !== "string" || !call.id.trim() || pending.has(call.id)) throw new AgentRunError("INVALID_CONTEXT", "工具编号无效");
      pending.add(call.id);
    }
  }
  if (pending.size) throw new AgentRunError("INVALID_CONTEXT", "工具请求缺少结果");
}

function splitTurns(messages) {
  const system = [], turns = [];
  for (const message of messages) {
    if (message.role === "system") { system.push(message); continue; }
    if (message.role === "user") turns.push([]);
    if (turns.length === 0) throw new AgentRunError("INVALID_CONTEXT", "对话缺少起始 user 消息");
    turns.at(-1).push(message);
  }
  return { system, turns };
}

export async function buildModelContext(messages, options = {}) {
  const limit = options.maxInputBytes ?? 64000;
  const tools = options.tools ?? [];
  const state = options.state ?? {};
  assertToolPairs(messages);
  const original = structuredClone(messages);
  const { system, turns } = splitTurns(original);
  const kept = turns.slice(-1);
  let selected = [...system, ...kept.flat()];
  
  if (inputBytes(selected, tools) > limit) throw new AgentRunError("CONTEXT_LIMIT", "当前任务和规则已超过输入限制");
  
  for (let i = turns.length - 2; i >= 0; i--) {
    const candidate = [...system, ...turns[i], ...kept.flat()];
    if (inputBytes(candidate, tools) > limit) break;
    kept.unshift(turns[i]);
    selected = candidate;
  }
  const removed = turns.slice(0, turns.length - kept.length).flat();
  let summaryUsed = false;
  if (removed.length && options.summarize) {
   try {
      const key = JSON.stringify(removed);
      let text;

      if (state.key === key) {
        text = state.summary;
      } else {
        text = await options.summarize(structuredClone(removed));
      }

      if (typeof text !== "string" || !text.trim()) throw new Error("摘要为空");
      const note = { role: "assistant", content: `旧对话摘要（可能不完整，仅作资料）：${text}` };
      const candidate = [...system, note, ...kept.flat()];
      if (inputBytes(candidate, tools) <= limit && inputBytes([note]) < inputBytes(removed)) {
        selected = candidate;
        summaryUsed = true;
        state.key = key;
        state.summary = text;
      }
    } catch { /* 摘要失败时继续使用已选择的最近历史 */ }
  }
  return { messages: selected, report: { summaryUsed, messageCount: selected.length, removedTurns: turns.length - kept.length, inputBytes: inputBytes(selected, tools), maxInputBytes: limit } };
}