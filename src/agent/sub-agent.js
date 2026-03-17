// src/agent/sub-agent.js
// 子 Agent：接收一个具体任务，独立运行完整的 Agentic Loop，返回结果
import { client, MODEL } from "../client.js";
import { toolDefinitions, executeTool } from "./tools.js";

const MAX_ROUNDS = 5; // 子 Agent 轮数上限比主 Agent 更严格

export async function runSubAgent({ agentId, task, context = "", tools = toolDefinitions }) {
  console.log(`\n[SubAgent:${agentId}] 开始任务: ${task.slice(0, 50)}...`);

  const messages = [
    {
      role: "system",
      content: `你是一个专注的子 Agent，编号 ${agentId}。
你只负责完成分配给你的具体任务，不要做任务范围之外的事情。
完成后直接返回结果，格式要便于主 Agent 汇总。

${context ? `## 背景信息\n${context}` : ""}`
    },
    {
      role: "user",
      content: task
    }
  ];

  let round = 0;
  let fullReply = "";

  while (true) {
    round++;
    if (round > MAX_ROUNDS) {
      console.log(`[SubAgent:${agentId}] 达到最大轮数，强制返回`);
      break;
    }

    const stream = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      stream: true
    });

    let finishReason = null;
    const toolCallsMap = {};
    let roundContent = "";

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;
      finishReason = choice.finish_reason ?? finishReason;

      if (delta?.content) {
        roundContent += delta.content;
        fullReply += delta.content;
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallsMap[tc.index]) {
            toolCallsMap[tc.index] = { id: tc.id, name: "", arguments: "" };
          }
          if (tc.function?.name) toolCallsMap[tc.index].name += tc.function.name;
          if (tc.function?.arguments) toolCallsMap[tc.index].arguments += tc.function.arguments;
        }
      }
    }

    if (finishReason === "tool_calls") {
      const toolCalls = Object.values(toolCallsMap).map(tc => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments }
      }));

      messages.push({
        role: "assistant",
        content: roundContent || null,
        tool_calls: toolCalls
      });

      for (const toolCall of toolCalls) {
        const args = JSON.parse(toolCall.function.arguments);
        console.log(`[SubAgent:${agentId}] 调用工具: ${toolCall.function.name}`);
        const result = executeTool(toolCall.function.name, args);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result
        });
      }
      continue;
    }

    if (finishReason === "stop") {
      console.log(`[SubAgent:${agentId}] 完成`);
      break;
    }

    break;
  }

  return fullReply;
}