// src/runs/run-registry.js
import { AgentRunError } from "../agent/run-policy.js";
import { RunContext } from "./run-context.js";

const statusByCode = {
  RUN_CANCELLED: "cancelled",
  RUN_TIMEOUT: "timed_out",
  MULTI_PARTIAL: "partial"
};

// 状态变化和工具调用是“事实”，要留档；逐字草稿只用于实时显示。
function isFact(record) {
  return record.type === "tool_call" ||
    (record.type === "run_event" && record.event.status !== undefined);
}

export class RunRegistry {
  #active = new Map();
  #store;
  #runOptions;

  constructor({ store = null, ...runOptions } = {}) {
    this.#store = store;
    this.#runOptions = runOptions;
  }

  start({ sessionId, request, mode }) {
    const run = new RunContext({ ...this.#runOptions, sessionId, mode });
    this.#active.set(run.runId, run);
    this.#write(run, { type: "run_started", sessionId, mode, request });
    return run;
  }

  record(run, payload) {
    const stamped = payload.type === "run_event"
      ? { ...payload, runId: run.runId, event: { ...payload.event, runId: run.runId, mode: run.mode } }
      : { ...payload, runId: run.runId };
    return isFact(stamped) ? this.#write(run, stamped) : stamped;
  }

  finish(run, outcome) {
    if (!this.#active.has(run.runId)) return null;
    run.dispose();
    this.#active.delete(run.runId);
    return this.#write(run, { type: "run_finished", ...outcome, usage: run.usage() });
  }

  fail(run, error) {
    const code = error instanceof AgentRunError ? error.code : "INTERNAL_ERROR";
    const message = error instanceof AgentRunError ? error.message : "服务执行异常，本次任务未完成。";
    return this.finish(run, { status: statusByCode[code] ?? "failed", code, message });
  }

  cancel(runId, sessionId) {
    const run = this.#active.get(runId);
    if (!run || run.sessionId !== sessionId) return false;
    run.stop("RUN_CANCELLED", "你已停止本次运行；已经完成的步骤不会撤销。");
    return true;
  }

  // 启动时调用：上次进程退出时还没写结束记录的运行，一律如实标记为中断。
  closeInterrupted() {
    const runIds = this.#store?.unfinishedRunIds() ?? [];
    for (const runId of runIds) {
      this.#store.append(runId, {
        type: "run_finished", runId, at: new Date().toISOString(), status: "interrupted",
        code: "PROCESS_RESTARTED", message: "服务在运行途中重启，本次运行已中断；需要时请重新发起。"
      });
    }
    return runIds.length;
  }

  recordsFor(sessionId) {
    return (this.#store?.listForSession(sessionId) ?? []).flat();
  }

  #write(run, record) {
    const stamped = { ...record, runId: run.runId, at: new Date().toISOString() };
    return this.#store ? this.#store.append(run.runId, stamped) : stamped;
  }
}