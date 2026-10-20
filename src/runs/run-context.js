// src/runs/run-context.js
import { randomUUID } from "node:crypto";
import { AgentRunError } from "../agent/run-policy.js";
import { runLimits } from "../config/run-limits.js";
import { RunBudget } from "./run-budget.js";
import { modelGate } from "./model-gate.js";

// 用到时才加载 SDK：只做记录、停止的代码和测试不需要模型密钥。
async function sendToModel(body, options) {
  const { client } = await import("../client.js");
  return client.chat.completions.create(body, options);
}

export class RunContext {
  #budget;
  #gate;
  #create;
  #controller = new AbortController();
  #timer;

  constructor({
    runId = randomUUID(), sessionId = "", mode = "single",
    maxModelCalls = runLimits.maxModelCalls, budget = new RunBudget({ maxModelCalls }),
    gate = modelGate, create = sendToModel, deadlineMs = runLimits.deadlineMs
  } = {}) {
    this.runId = runId;
    this.sessionId = sessionId;
    this.mode = mode;
    this.#budget = budget;
    this.#gate = gate;
    this.#create = create;
    this.#timer = setTimeout(() => this.stop("RUN_TIMEOUT",
      `本次运行超过 ${Math.round(deadlineMs / 1000)} 秒，已停止。`), deadlineMs);
  }

  get signal() {
    return this.#controller.signal;
  }

  stop(code, message) {
    if (!this.signal.aborted) this.#controller.abort(new AgentRunError(code, message));
  }

  checkpoint() {
    if (this.signal.aborted) throw this.signal.reason;
  }

  // 所有模型请求的唯一出口：先排队，再记账，最后才发出。
  async complete(request, operation = "agent_loop") {
    this.checkpoint();
    const release = await this.#gate.acquire(this.signal);
    try {
      this.checkpoint();
      this.#budget.spend(operation);
      const response = await this.#create(request, { signal: this.signal, maxRetries: 0 });
      if (!request.stream) {
        release();
        return response;
      }
      return this.#holdUntilStreamEnds(response, release);
    } catch (error) {
      release();
      throw this.signal.aborted ? this.signal.reason : error;
    }
  }

  async *#holdUntilStreamEnds(stream, release) {
    try {
      for await (const chunk of stream) {
        this.checkpoint();
        yield chunk;
      }
      // OpenAI SDK 被中止时会安静地结束流、不抛错；读完以后必须再查一次。
      this.checkpoint();
    } catch (error) {
      throw this.signal.aborted ? this.signal.reason : error;
    } finally {
      release();
    }
  }

  usage() {
    return this.#budget.report();
  }

  dispose() {
    clearTimeout(this.#timer);
  }
}