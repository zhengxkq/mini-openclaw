import { client, MODEL } from "../client.js";
import { toolDefinitions } from "./tools.js";
import { ToolCallAccumulator } from "./tool-call-stream.js";
import { AgentRunError } from "./run-policy.js";

// requestModel 是测试接缝；正常产品省略它，仍调用原来的 SDK。
export async function sampleModel(messages, requestModel, onTextDelta) {
  const create = requestModel ?? (request => client.chat.completions.create(request));
  const collector = new ToolCallAccumulator();
  let answer = "", finishReason = null, usage = null;
  try {
    const stream = await create({ model: MODEL, messages, tools: toolDefinitions,
      stream: true, stream_options: { include_usage: true } });
    for await (const chunk of stream) {
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      finishReason = choice.finish_reason ?? finishReason;
      const text = choice.delta?.content ?? "";
      answer += text;
      if (text) {
        try { await onTextDelta?.(text); }
        catch { throw new AgentRunError("OUTPUT_ERROR", "草稿推送失败，本次运行已停止。"); }
      }
      // 同一片段可以同时包含文字与工具增量，不能写成 else if。
      if (choice.delta?.tool_calls) collector.add(choice.delta.tool_calls);
    }
    return { answer, finishReason, toolCalls: collector.build(), usage };
  } catch (error) {
    if (error instanceof AgentRunError) throw error;
    throw new AgentRunError("MODEL_ERROR", "模型响应未能完整收到，本次运行已停止。");
  }
}