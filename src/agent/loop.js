// src/agent/loop.js（最终版）
import { client, MODEL } from "../client.js";
import { toolDefinitions, executeTool } from "./tools.js";
import { SkillsLoader } from "./skills-loader.js";
import { costTracker } from "../observability/cost-tracker.js";
import { createLogger } from "../observability/logger.js";
import { AgentRunError, prepareToolCalls, assertToolResult } from "./run-policy.js";
import { RunController } from "./run-controller.js";
import { sampleModel } from "./model-step.js";

const MAX_ROUNDS = 10;
const skillsLoader = new SkillsLoader();
const logger = createLogger('AgentLoop');

export async function runAgentLoop(messages, onChunk, onToolCall, executeToolFn, options = {}) {
  const run = new RunController({ maxRounds: MAX_ROUNDS, ...options });
  const doExecute = executeToolFn ?? executeTool;
  const toolResults = [];
  let draftId = null, draftSeq = 0;
  const notifyDraft = async details => {
    const event = { ...details, type: "assistant_draft", runId: run.id,
      draftId, round: run.round, seq: ++draftSeq };
    try { await options.onDraft?.(event); }
    catch { throw new AgentRunError("OUTPUT_ERROR", "草稿推送失败，本次运行已停止。"); }
  };
  const notifyTool = async event => {
    try { await onToolCall?.(event); }
    catch { throw new AgentRunError("OUTPUT_ERROR", "工具状态推送失败，本次运行已停止。"); }
  };

  try {
    while (true) {
      // ① 控制器先批准下一轮，才允许请求模型。
      await run.beginRound();

      draftId = `${run.id}:${run.round}`;
      await notifyDraft({ action: "start" });

      console.log("[课2]模型输入", JSON.stringify({ round: run.round, messages }));
      const step = await sampleModel(messages, options.requestModel, text => notifyDraft({ action: "delta", text }));
      if (step.usage) {
        costTracker.record({ model: MODEL, inputTokens: step.usage.prompt_tokens,
          outputTokens: step.usage.completion_tokens, sessionId: messages[0]?.sessionId,
          operation: "agent_loop" });
      }
      await run.move("deciding", "模型响应已收齐，应用决定下一步", {
        finishReason: step.finishReason, toolCount: step.toolCalls.length
      });

      // ② 工具请求：先检查整批，再通过原执行器执行，最后回填。
      if (step.finishReason === "tool_calls") {
        await run.move("validating", "检查工具名称、编号与参数");
        const prepared = prepareToolCalls(step.toolCalls, toolDefinitions);
        await notifyDraft({ action: "status", status: "intermediate", reason: "本轮转入工具执行，这段文字是过程说明" });
        messages.push({ role: "assistant", content: step.answer || null,
          tool_calls: prepared.map(item => item.toolCall) });
        await run.move("executing", "整批请求检查通过，进入执行器；权限由 Sandbox 再检查");

        for (const { toolCall, args } of prepared) {
          const name = toolCall.function.name;
          const event = { id: toolCall.id, name, args };
          await notifyTool({ ...event, status: "running" });
          let result;
          try {
            result = await doExecute(name, args);
            assertToolResult(result, name);
          } catch (error) {
            await notifyTool({ ...event, status: "error" });
            if (error instanceof AgentRunError) throw error;
            throw new AgentRunError("TOOL_FAILED", `${name} 执行异常，本次运行已停止。`);
          }
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
          toolResults.push({ id: toolCall.id, name, args: structuredClone(args), content: result });
          console.log("[课2]工具返回", toolCall.id, result);
          await notifyTool({ ...event, status: "done" });
        }
        await run.move("ready", "工具结果已写回，继续让模型处理结果", { decision: "continue" });
        draftId = null;
        continue;
      }

      // ③ 模型说 stop 只是候选回答；能否接受，由应用的验收函数决定。
      if (step.finishReason !== "stop" || step.toolCalls.length > 0) {
        throw new AgentRunError("MODEL_FINISH_ERROR", `模型响应不完整或不一致：${step.finishReason ?? "缺少结束原因"}`);
      }
      await run.move("checking", "模型停止输出，开始检查候选回答");
      await notifyDraft({ action: "status", status: "checking", reason: "文字已收齐，正在验收" });
      const verdict = await run.reviewAnswer({ answer: step.answer, messages, toolResults });
      if (verdict.action === "continue") {
        await notifyDraft({ action: "status", status: "rejected", reason: verdict.reason });
        messages.push({ role: "assistant", content: step.answer });
        // 这是应用生成的补充要求，不冒充新的用户消息。
        messages.push({ role: "system", content: `应用验收反馈：${verdict.followUp}` });
        await run.move("ready", verdict.reason, { decision: "continue", source: "completion_check" });
        draftId = null;
        continue;
      }

      // 候选答案验收后才发给用户，避免被否决的答案残留在页面。
      try { await onChunk?.(step.answer); }
      catch { throw new AgentRunError("OUTPUT_ERROR", "回答推送失败，本次运行已停止。"); }
      await notifyDraft({ action: "status", status: "accepted", reason: verdict.reason });
      draftId = null;
      await run.move("responded", verdict.reason, { decision: "accept", goalStatus: verdict.goalStatus });
      return step.answer;
    }
  } catch (error) {
    const failure = error instanceof AgentRunError ? error
      : new AgentRunError("INTERNAL_ERROR", "运行过程发生异常，本次任务未完成。");

    if (draftId) {
      try { await notifyDraft({ action: "status", status: "failed", reason: failure.message }); }
      catch { /* 推送也失败时保留原错误，Gateway 继续处理 error / done。 */ }
    }

    await run.fail(failure);
    throw failure;
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