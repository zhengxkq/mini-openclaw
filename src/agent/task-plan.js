import { AgentRunError } from "./run-policy.js";

export function parseTaskPlan(text) {
  const reject = () => {
    throw new AgentRunError("INVALID_PLAN",
      "计划必须包含1至5个不重复、非空的独立任务，每项最多1200字符。");
  };
  if (typeof text !== "string" || text.length > 24000) reject();

  const cleaned = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  let value;
  try { value = JSON.parse(cleaned); } catch { reject(); }

  if (!value || !Array.isArray(value.tasks) ||
      value.tasks.length < 1 || value.tasks.length > 5) reject();

  const seen = new Set();
  const tasks = value.tasks.map((item, index) => {
    if (!item || typeof item.task !== "string") reject();
    const task = item.task.trim();
    if (!task || task.length > 1200 || seen.has(task)) reject();
    if (item.dependsOn !== undefined &&
        (!Array.isArray(item.dependsOn) || item.dependsOn.length > 0)) reject();
    seen.add(task);
    return { id: "t" + (index + 1), task };
  });
  return { tasks, summary_instruction: "按计划顺序保留各项结果与出处" };
}