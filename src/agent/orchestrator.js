// src/agent/orchestrator.js
import { client, MODEL } from "../client.js";
import { runSubAgent } from "./sub-agent.js";

// ─── 第一步：让主 Agent 拆解任务 ─────────────────────────────
async function planTasks(userRequest) {
  console.log("\n[Orchestrator] 开始任务规划...");

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `你是一个任务规划专家。
将用户的复杂请求拆解成多个独立的子任务。

规则：
- 每个子任务必须可以独立完成，不依赖其他子任务的结果
- 子任务数量控制在 2-5 个
- 每个子任务描述要具体明确
- 只返回 JSON，格式如下，不要有任何其他文字：
{
  "tasks": [
    { "id": "1", "task": "子任务描述" },
    { "id": "2", "task": "子任务描述" }
  ],
  "summary_instruction": "汇总时的要求"
}`
      },
      {
        role: "user",
        content: userRequest
      }
    ]
  });

  const content = response.choices[0].message.content;

  try {
    // 清理可能的 markdown 代码块
    const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("[Orchestrator] 任务规划解析失败:", content);
    // 解析失败时降级为单任务
    return {
      tasks: [{ id: "1", task: userRequest }],
      summary_instruction: "直接返回结果"
    };
  }
}

// ─── 第二步：并行执行所有子任务 ───────────────────────────────
async function executeTasksInParallel(tasks) {
  console.log(`\n[Orchestrator] 并行执行 ${tasks.length} 个子任务`);

  const startTime = Date.now();

  // Promise.all 并行执行，所有子 Agent 同时跑
  const results = await Promise.all(
    tasks.map(({ id, task }) =>
      runSubAgent({ agentId: id, task })
        .then(result => ({ id, task, result, success: true }))
        .catch(e => ({ id, task, result: `执行失败: ${e.message}`, success: false }))
    )
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Orchestrator] 所有子任务完成，耗时 ${elapsed}s`);

  return results;
}

// ─── 第三步：汇总结果 ─────────────────────────────────────────
async function summarizeResults(userRequest, taskResults, summaryInstruction) {
  console.log("\n[Orchestrator] 开始汇总结果...");

  const resultsText = taskResults
    .map(r => `### 子任务 ${r.id}\n任务：${r.task}\n结果：${r.result}`)
    .join("\n\n");

  const stream = await client.chat.completions.create({
    model: MODEL,
    stream: true,
    messages: [
      {
        role: "system",
        content: `你是一个结果汇总专家。
将多个子任务的结果整合成一个完整、连贯的回答。
汇总要求：${summaryInstruction}`
      },
      {
        role: "user",
        content: `用户的原始请求：${userRequest}\n\n各子任务结果：\n${resultsText}`
      }
    ]
  });

  let fullReply = "";
  process.stdout.write("\n[汇总结果] ");

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      fullReply += delta;
      process.stdout.write(delta);
    }
  }
  console.log("\n");

  return fullReply;
}

// ─── 主入口：完整的多 Agent 流程 ──────────────────────────────
export async function runMultiAgent(userRequest, onChunk) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[MultiAgent] 收到请求: ${userRequest}`);
  console.log("=".repeat(60));

  // 1. 规划
  const plan = await planTasks(userRequest);
  console.log(`\n[Orchestrator] 规划完成，子任务数: ${plan.tasks.length}`);
  plan.tasks.forEach(t => console.log(`  [${t.id}] ${t.task}`));

  // 通知用户开始工作
  onChunk?.(`🤔 正在规划任务，拆分为 ${plan.tasks.length} 个子任务...\n`);

  // 2. 并行执行
  const results = await executeTasksInParallel(plan.tasks);

  onChunk?.(`⚡ ${plan.tasks.length} 个子任务并行执行完成，正在汇总...\n`);

  // 3. 汇总
  const summary = await summarizeResults(
    userRequest,
    results,
    plan.summary_instruction
  );

  onChunk?.(summary);
  return summary;
}