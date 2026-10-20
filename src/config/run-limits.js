// src/config/run-limits.js
// 一次运行的三条边界：可以用环境变量调整，默认值面向本机个人使用。
function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} 必须是正整数。`);
  return value;
}

export const runLimits = {
  maxModelCalls: positiveInteger("RUN_MAX_MODEL_CALLS", 20),
  deadlineMs: positiveInteger("RUN_DEADLINE_MS", 120_000),
  modelConcurrency: positiveInteger("MODEL_CONCURRENCY", 2)
};