import { randomUUID } from "node:crypto";

export function identityKey({ provider, model, protocol }) {
  return JSON.stringify([provider, model, protocol]);
}

export function openAIChatUsage(raw) {
  const inputTokens = raw?.prompt_tokens;
  const outputTokens = raw?.completion_tokens;
  if (![inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) {
    return null;
  }
  return { inputTokens, outputTokens,
    cachedInputTokens: Number.isSafeInteger(raw?.prompt_tokens_details?.cached_tokens) && raw.prompt_tokens_details.cached_tokens >= 0
      ? raw.prompt_tokens_details.cached_tokens : null,
    reasoningOutputTokens: Number.isSafeInteger(raw?.completion_tokens_details?.reasoning_tokens) && raw.completion_tokens_details.reasoning_tokens >= 0
      ? raw.completion_tokens_details.reasoning_tokens : null };
}

export function readUsage(identity, raw, adapters) {
  const adapter = adapters.get(identityKey(identity));
  if (!adapter) return { source: "unsupported", tokens: null };
  const tokens = adapter(raw);
  return { source: tokens ? "provider" : "missing", tokens };
}

export async function measureCompletion(create, request, context) {
  const { identity, adapters, record, operation = "unknown", runId = null,
    sessionId = null, taskId = null, clock = () => performance.now() } = context;
  const started = clock();
  const event = {
    id: randomUUID(), at: new Date().toISOString(), identity, operation,
    runId, sessionId, taskId,
    requestBytes: Buffer.byteLength(JSON.stringify(request), "utf8"),
    firstChunkMs: null, elapsedMs: null, status: "incomplete",
    usageSource: "missing", tokens: null, responseModel: null
  };
  let saved = false;
  let rawUsage = null;
  const observe = response => {
    if (response?.usage) rawUsage = response.usage;
    if (typeof response?.model === "string") event.responseModel = response.model;
    const delta = response?.choices?.[0]?.delta;
    if (event.firstChunkMs === null && (delta?.content || delta?.tool_calls?.length)) {
      event.firstChunkMs = Math.max(0, clock() - started);
    }
  };
  const save = () => {
    if (saved) return;
    saved = true;
    const usage = readUsage(identity, rawUsage, adapters);
    event.usageSource = usage.source;
    event.tokens = usage.tokens;
    event.elapsedMs = Math.max(0, clock() - started);
    record({ ...event });
  };
  // 先留开始记录，进程中断或返回的流没来得及消费也不会消失。
  record({ ...event });
  let response;
  try {
    response = await create(request);
  } catch (error) {
    event.status = "failed";
    save();
    throw error;
  }
  if (!request.stream) {
    observe(response);
    event.status = "completed";
    save();
    return response;
  }
  const measured = (async function* () {
    try {
      for await (const chunk of response) {
        observe(chunk);
        yield chunk;
      }
      event.status = "completed";
    } catch (error) {
      event.status = "failed";
      throw error;
    } finally {
      save();
    }
  })();
  // SDK 的流取消控制器仍可由调用方使用；信号也继续由原请求边界传入。
  measured.controller = response.controller;
  return measured;
}