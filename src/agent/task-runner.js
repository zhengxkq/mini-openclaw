import { AgentRunError } from "./run-policy.js";
import { parseTaskPlan } from "./task-plan.js";

const stoppedCodes = new Set(["RUN_CANCELLED", "RUN_TIMEOUT"]);
const statusLabel = { succeeded: "已接受", failed: "失败", cancelled: "已停止", skipped: "已跳过" };
const phaseFor = {
    succeeded: "子答案已接受", failed: "子任务失败",
    cancelled: "运行已停止，本项未完成", skipped: "前置任务未成功，本项跳过"
};

export async function collectTaskResults(plan, { runTask, onEvent } = {}) {
    if (typeof runTask !== "function") {
        throw new AgentRunError("INVALID_RUNNER", "子任务执行函数未接入。");
    }
    const { tasks } = parseTaskPlan(JSON.stringify(plan));
    const emit = async event => { await onEvent?.(event); };

    // 先建立完整名单，再启动。页面不会把“尚未开始”误认成“不存在”。
    for (const { id, task } of tasks) {
        await emit({ taskId: id, task, status: "queued", phase: "等待开始", draft: "" });
    }

    async function runOne({ id, task, inputs }) {
        await emit({ taskId: id, task, status: "running", phase: "正在执行" });
        try {
            const answer = await runTask({ id, task, inputs });
            if (typeof answer !== "string" || !answer.trim()) {
                throw new AgentRunError("INVALID_ANSWER", "子任务没有交付非空答案。");
            }
            return { id, task, status: "succeeded", answer };
        } catch (error) {
            const code = error instanceof AgentRunError ? error.code : "SUBTASK_FAILED";
            return {
                id, task, status: stoppedCodes.has(code) ? "cancelled" : "failed", code,
                message: error instanceof AgentRunError ? error.message : "子任务执行异常，本项未完成。"
            };
        }
    }

    // 每项都是一个 Promise；后项先等自己的前置项落定，再决定执行还是跳过。
    const settled = new Map();
    for (const { id, task, dependsOn } of tasks) {
        settled.set(id, (async () => {
            const inputs = await Promise.all(dependsOn.map(dep => settled.get(dep)));
            const blocked = inputs.filter(input => input.status !== "succeeded");
            const result = blocked.length
                ? {
                    id, task, status: "skipped", code: "DEPENDENCY_FAILED",
                    message: `前置任务 ${blocked.map(input => input.id).join("、")} 没有成功，本项未开始。`
                }
                : await runOne({ id, task, inputs });
            await emit({
                taskId: id, task, status: result.status, draft: "",
                phase: phaseFor[result.status],
                ...(result.status === "succeeded"
                    ? { answer: result.answer }
                    : { code: result.code, message: result.message })
            });
            return result;
        })());
    }
    const results = await Promise.all(tasks.map(({ id }) => settled.get(id)));

    const accepted = results.filter(result => result.status === "succeeded").length;
    const status = accepted === results.length ? "succeeded" : accepted === 0 ? "failed" : "partial";
    const blocks = results.map(result => [
        "### " + result.id + " · " + statusLabel[result.status],
        "任务：" + result.task,
        result.status === "succeeded" ? result.answer : result.code + "：" + result.message
    ].join("\n\n"));
    const answer = [
        "子任务结果：已接受 " + accepted + "/" + results.length + " 项；失败 " +
        (results.length - accepted) + " 项。",
        "“已接受”表示通过本课运行检查，不代表事实已核实，也不保证计划覆盖了原请求的全部要求。",
        ...blocks
    ].join("\n\n");
    return { status, answer, results };
}