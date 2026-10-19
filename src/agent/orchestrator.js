// src/agent/orchestrator.js
import { runSubAgent } from "./sub-agent.js";
import { randomUUID } from "node:crypto";
import { runAgentLoop } from "./loop.js";
import { parseTaskPlan } from "./task-plan.js";
import { AgentRunError } from "./run-policy.js";
import { collectTaskResults } from "./task-runner.js";


// ─── 第一步：让主 Agent 拆解任务 ─────────────────────────────
export async function planTasks(userRequest, options = {}) {
    const messages = [
        {
            role: "system", content:
                "把用户请求拆成1至5个可独立交付的子任务，只返回JSON，不要解释。" +
                '格式：{"tasks":[{"task":"具体任务"}]}。' +
                "本课子任务只开放 calculate 和 search_documents。" +
                "保留用户的完整故障编号、需要核对的字段和引用要求。" +
                "不要拆出需要其他子任务结果的任务，不要自行扩大用户范围。"
        },
        { role: "user", content: userRequest }
    ];
    const answer = await runAgentLoop(
        messages, () => { }, () => { },
        async () => {
            throw new AgentRunError("TOOL_NOT_ALLOWED", "规划阶段不执行工具。");
        },
        {
            tools: [], maxRounds: 2, contextState: {},
            createCompletion: options.planCompletion,
            onEvent: event => options.onEvent?.({
                ...event, phase: event.phase ? "规划：" + event.phase : undefined
            }),
            checkCompletion: ({ answer }) => {
                try {
                    parseTaskPlan(answer);
                    return { action: "accept" };
                } catch {
                    return {
                        action: "continue",
                        followUp: "计划不符合要求。只返回含1至5个非空、不重复、独立任务的JSON；" +
                            "每个task最多1200字符，不要声明任务依赖。"
                    };
                }
            }
        }
    );
    return parseTaskPlan(answer);
}


// ─── 主入口：完整的多 Agent 流程 ──────────────────────────────
export async function runMultiAgent(userRequest, onChunk, options = {}) {
    if (typeof options.executeToolFn !== "function") {
        throw new AgentRunError("MISSING_EXECUTOR", "多Agent入口必须提供带沙箱的工具执行函数。");
    }
    const runId = randomUUID();
    const runtime = {
        ...options,
        runId,
        onEvent: event => options.onEvent?.({ ...event, runId }),
        onToolCall: event => options.onToolCall?.({ ...event, runId })
    };
    await runtime.onEvent({ status: "running", phase: "正在规划", draft: "" });

    try {
        const plan = await planTasks(userRequest, runtime);
        await runtime.onEvent({ status: "running", phase: "正在执行子任务", draft: "" });
        const result = await collectTaskResults(plan, {
            runTask: ({ id, task }) => runSubAgent({ ...runtime, agentId: id, task }),
            onEvent: runtime.onEvent
        });
        await runtime.onEvent({
            status: result.status, draft: "",
            phase: result.status === "succeeded" ? "各项答案已接受"
                : result.status === "partial" ? "部分子任务失败" : "全部子任务失败"
        });
        await onChunk?.(result.answer);
        return { runId, ...result };
    } catch (error) {
        await runtime.onEvent({ status: "failed", phase: "编排停止", draft: "" });
        throw error;
    }
}