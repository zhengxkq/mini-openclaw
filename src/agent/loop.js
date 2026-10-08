// src/agent/loop.js（最终版）
import { client, MODEL } from "../client.js";
import { collectToolDelta } from "./tool-call-stream.js";
import { AgentRunError, prepareToolCalls, assertToolResult, assertVerdict } from "./run-policy.js";
import { toolDefinitions, executeTool } from "./tools.js";
import { SkillsLoader } from "./skills-loader.js";
import { costTracker } from "../observability/cost-tracker.js";
import { createLogger } from "../observability/logger.js";



const MAX_ROUNDS = 10;
const skillsLoader = new SkillsLoader();
const logger = createLogger('AgentLoop');

export async function runAgentLoop(messages, onChunk, onToolCall, executeToolFn, options = {}) {
  const emit = async event => { await options.onEvent?.(event); };
  let round = 0;
  let repairs = 0;
  const checkCompletion = options.checkCompletion ?? (() => ({ action: "accept" }));

  const doExecute = executeToolFn ?? executeTool;

  try {
    while (true) {
      round++;

      if (round > MAX_ROUNDS) {
        throw new AgentRunError("ROUND_LIMIT", `已达到 ${MAX_ROUNDS} 轮，本次任务未完成。`);
      }

      await emit({ round, phase: "正在请求模型", draft: "" });
      console.log("[本轮请求]", round, messages.map(m => m.role));
      // 全程用流式，通过 finish_reason 判断走哪条路
      const stream = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools: toolDefinitions,
        stream: true,
        stream_options: { include_usage: true }  // ← 加这个才能拿到 usage
      });

      // 需要自己从流里「拼」出完整的 assistant 消息
      let fullContent = "";
      let finishReason = null;
      const toolCallsMap = {}; // index → { id, name, arguments }
      let usage = null;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) {
          // 最后一个 chunk 没有 choices，但有 usage
          if (chunk.usage) usage = chunk.usage;  // ← 新增
          continue;
        }

        const delta = choice.delta;
        finishReason = choice.finish_reason ?? finishReason;

        // 普通文字内容——实时推出去
        if (delta?.content) {
          fullContent += delta.content;
          if (options.onEvent) await emit({ round, draft: fullContent });
          else await onChunk?.(delta.content);
        }

        // 工具调用内容——流式里是分块传来的，需要手动拼接
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            collectToolDelta(toolCallsMap, tc);
          }
        }
      }

      console.log("[本轮结束]", round, finishReason);
      // ── 情况1：AI 要调工具 ────────────────────────────────────
      if (finishReason === "tool_calls") {
        const toolCalls = Object.values(toolCallsMap).map(tc => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments }
        }));

        await emit({ round, phase: "正在检查工具请求" });
        const prepared = prepareToolCalls(toolCalls, toolDefinitions);
        await emit({ round, phase: "正在执行工具" });
        // 把 AI 的工具调用消息加入历史
        messages.push({
          role: "assistant",
          content: fullContent || null,
          tool_calls: toolCalls
        });

        // 执行所有工具
        for (const { toolCall, args } of prepared) {
          const toolName = toolCall.function.name;

          const event = { id: toolCall.id, name: toolName, args };
          await onToolCall?.({ ...event, status: "running" });

          let result;
          try {
            result = await doExecute(toolName, args);
            assertToolResult(result);
          } catch (error) {
            await onToolCall?.({ ...event, status: "error" });
            throw error instanceof AgentRunError ? error : new AgentRunError("TOOL_FAILED", "工具执行失败。");
          }
          console.log("[工具结果]", toolCall.id, toolName, result);

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result
          });
          await onToolCall?.({ ...event, status: "done" });
          console.log("[回填]", toolCall.id, messages.at(-1).tool_call_id);
        }

        console.log('模型usage:', usage);
        // 流结束后记录费用
        if (usage) {
          const cost = costTracker.record({
            model: MODEL,
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            sessionId: messages[0]?.sessionId,
            operation: "agent_loop"
          });
          logger.debug("API调用费用", {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            cost: `¥${cost.totalCost.toFixed(6)}`
          });
        }
        continue; // 继续循环
      }

      // ── 情况2：正常结束 ───────────────────────────────────────
      if (finishReason === "stop") {
        if (Object.keys(toolCallsMap).length > 0 || !fullContent.trim()) {
          throw new AgentRunError("INVALID_ANSWER", "模型没有给出完整的文字回答。");
        }

        await emit({ round, phase: "正在验收回答" });
        const verdict = await checkCompletion({ answer: fullContent, messages: structuredClone(messages) });
        assertVerdict(verdict);
        if (verdict.action === "continue") {
          if (repairs >= 1) throw new AgentRunError("COMPLETION_LIMIT", "补答后仍未通过，任务停止。");
          repairs++;
          messages.push({ role: "assistant", content: fullContent });
          messages.push({ role: "system", content: `应用要求补答：${verdict.followUp}` });
          continue;
        }
        await emit({ round, phase: "回答已接受（不代表事实已核实）", draft: "" });

        if (options.onEvent) await onChunk?.(fullContent);
        return fullContent;
      }

      // ── 情况3：意外情况 ───────────────────────────────────────
      throw new AgentRunError("MODEL_FINISH_ERROR", `模型没有完整结束：${finishReason ?? "缺失"}`);
    }
  } catch (error) {
    await emit({ round, phase: "任务失败", draft: "" });
    throw error;
  }
}

export function buildSystemPrompt(soulContent = "", sessionId = "", episodicContent = "", proceduralContent = "") {
  const skillsContent = skillsLoader.load();
  // 生成北京时间字符串
  const now = new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit", 
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  
  // 生成带时区的 ISO 时间，让 AI 知道该怎么写
  const nowISO = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }))
    .toISOString().replace("Z", "+08:00");
    
  return `你是 Molty，一个运行在 OpenClaw 上的 AI 助手 🦞
你说话简洁直接，必要时使用工具获取真实信息。

## 当前时间
- 现在是北京时间：${now}
- 设置提醒时，时间格式必须带时区，例如：2026-03-09T15:02:00+08:00
- 当前时间的 ISO 格式参考：${nowISO}

${sessionId ? `## 当前会话信息\n- 当前用户的 session_id 是：${sessionId}\n- 设置提醒时必须使用这个 session_id，不能用其他值` : ""}

${proceduralContent}

${soulContent ? `## 关于你的记忆\n${soulContent}` : ""}

${episodicContent}

${skillsContent}

## 工具使用原则
- 需要实时数据时主动调用工具，不要凭空猜测
- 可以连续调用多个工具
- 工具失败时告诉用户原因，不要假装成功
- 当用户表达了对回复风格的偏好时，主动调用 add_behavior_rule 工具保存`.trim();

}


// 判断任务是否适合用多 Agent 处理
// 简单规则：包含「对比」「分别」「各个」「同时」等关键词时触发
export function shouldUseMultiAgent(userMessage) {
  const triggers = [
    /对比|比较|比一比/,
    /分别(查|计算|分析|获取)/,
    /每个|各个|所有.*城市/,
    /同时(查|做|处理)/,
    /并行|多个任务/
  ];
  return triggers.some(pattern => pattern.test(userMessage));
}
