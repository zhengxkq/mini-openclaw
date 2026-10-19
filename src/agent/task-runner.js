import { AgentRunError } from "./run-policy.js";
import { parseTaskPlan } from "./task-plan.js";

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

  const results = await Promise.all(tasks.map(async ({ id, task }) => {
    await emit({ taskId: id, task, status: "running", phase: "正在执行" });
    let result;
    try {
      const answer = await runTask({ id, task });
      if (typeof answer !== "string" || !answer.trim()) {
        throw new AgentRunError("INVALID_ANSWER", "子任务没有交付非空答案。");
      }
      result = { id, task, status: "succeeded", answer };
    } catch (error) {
      result = {
        id, task, status: "failed",
        code: error instanceof AgentRunError ? error.code : "SUBTASK_FAILED",
        message: error instanceof AgentRunError ? error.message : "子任务执行异常，本项未完成。"
      };
    }
    await emit({
      taskId: id, task, status: result.status, draft: "",
      phase: result.status === "succeeded" ? "子答案已接受" : "子任务失败",
      ...(result.status === "succeeded"
        ? { answer: result.answer }
        : { code: result.code, message: result.message })
    });
    return result;
  }));

  const accepted = results.filter(result => result.status === "succeeded").length;
  const status = accepted === results.length ? "succeeded" : accepted === 0 ? "failed" : "partial";
  const blocks = results.map(result => [
    "### " + result.id + " · " + (result.status === "succeeded" ? "已接受" : "失败"),
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