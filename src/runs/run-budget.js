// src/runs/run-budget.js
import { AgentRunError } from "../agent/run-policy.js";

export class RunBudget {
  #limit;
  #used = 0;
  #byOperation = {};

  constructor({ maxModelCalls = 20 } = {}) {
    if (!Number.isInteger(maxModelCalls) || maxModelCalls < 1) {
      throw new AgentRunError("INVALID_BUDGET", "模型请求上限必须是正整数。");
    }
    this.#limit = maxModelCalls;
  }

  spend(operation) {
    if (this.#used >= this.#limit) {
      throw new AgentRunError("BUDGET_EXHAUSTED",
        `本次运行已用完 ${this.#limit} 次模型请求，剩余步骤没有开始。`);
    }
    this.#used++;
    this.#byOperation[operation] = (this.#byOperation[operation] ?? 0) + 1;
  }

  report() {
    return { limit: this.#limit, used: this.#used, byOperation: { ...this.#byOperation } };
  }
}