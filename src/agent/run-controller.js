import { randomUUID } from "node:crypto";
import { AgentRunError } from "./run-policy.js";

const NEXT = {
  ready: ["sampling", "failed", "exhausted"],
  sampling: ["deciding", "failed"],
  deciding: ["validating", "checking", "failed"],
  validating: ["executing", "failed"],
  executing: ["ready", "failed"],
  checking: ["ready", "responded", "failed", "exhausted"],
  responded: [], failed: [], exhausted: []
};

export function acceptNonEmptyAnswer({ answer }) {
  return answer.trim()
    ? { action: "accept", reason: "已收到非空回答", goalStatus: "not_checked" }
    : { action: "continue", reason: "模型结束但没有回答", followUp: "请根据已有上下文给出非空的最终回答。" };
}

export class RunController {
  #phase = "ready";
  #round = 0;
  #seq = 0;
  #repairs = 0;
  #runId;
  #maxRounds;
  #maxRepairs;
  #onEvent;
  #checkCompletion;

  constructor({ runId = randomUUID(), maxRounds = 10, maxRepairs = 1,
    onEvent, checkCompletion = acceptNonEmptyAnswer } = {}) {
    if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 100 ||
        !Number.isInteger(maxRepairs) || maxRepairs < 0 || maxRepairs > 10 ||
        typeof checkCompletion !== "function") {
      throw new AgentRunError("INVALID_RUN_OPTIONS", "运行预算或验收函数配置不正确。");
    }
    this.#runId = runId;
    this.#maxRounds = maxRounds;
    this.#maxRepairs = maxRepairs;
    this.#onEvent = onEvent;
    this.#checkCompletion = checkCompletion;
  }
  get id() { return this.#runId; }
  
  get round() { return this.#round; }

  async move(next, reason, details = {}) {
    if (!NEXT[this.#phase].includes(next)) {
      throw new AgentRunError("INVALID_RUN_TRANSITION", `不能从 ${this.#phase} 进入 ${next}`);
    }
    this.#phase = next;
    const event = { ...details, type: "run_state", runId: this.#runId,
      seq: ++this.#seq, phase: next, round: this.#round, reason,
      remaining: this.#maxRounds - this.#round, at: new Date().toISOString() };
    // 观察通道不参与决策；本课的记录是尽力发送，不是可靠事件存储。
    try { await this.#onEvent?.(event); }
    catch (error) { console.warn("[Harness] 运行记录发送失败：", error.message); }
  }

  async beginRound() {
    if (this.#phase !== "ready") {
      throw new AgentRunError("INVALID_RUN_TRANSITION", "只有 ready 状态可以请求模型。");
    }
    if (this.#round >= this.#maxRounds) {
      throw new AgentRunError("ROUND_LIMIT", `已用完 ${this.#maxRounds} 次模型请求，任务尚未完成。`);
    }
    this.#round++;
    await this.move("sampling", "开始请求模型");
  }

  async reviewAnswer(input) {
    if (this.#phase !== "checking") {
      throw new AgentRunError("INVALID_RUN_TRANSITION", "只有 checking 状态可以验收回答。");
    }
    let verdict;
    try { verdict = await this.#checkCompletion(structuredClone(input)); }
    catch { throw new AgentRunError("COMPLETION_CHECK_ERROR", "应用的回答验收函数执行失败。"); }
    if (!verdict || !["accept", "continue"].includes(verdict.action) ||
        typeof verdict.reason !== "string" || !verdict.reason.trim() ||
        (verdict.action === "accept" && !["not_checked", "verified"].includes(verdict.goalStatus)) ||
        (verdict.action === "continue" && (typeof verdict.followUp !== "string" || !verdict.followUp.trim()))) {
      throw new AgentRunError("INVALID_COMPLETION_DECISION", "验收函数必须返回完整的 accept 或 continue 决定。");
    }
    if (verdict.action === "continue") {
      if (this.#repairs >= this.#maxRepairs) {
        throw new AgentRunError("COMPLETION_LIMIT", "回答仍未通过验收，已用完补充回答的机会。");
      }
      this.#repairs++;
    }
    return verdict;
  }

  async fail(error) {
    if (NEXT[this.#phase].length === 0) return;
    const exhausted = ["ROUND_LIMIT", "COMPLETION_LIMIT"].includes(error.code);
    await this.move(exhausted ? "exhausted" : "failed", error.message, { code: error.code });
  }
}