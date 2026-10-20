// src/runs/model-gate.js
import { runLimits } from "../config/run-limits.js";

export class ModelGate {
  #limit;
  #active = 0;
  #waiting = [];

  constructor(limit = 2) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("并发上限必须是正整数。");
    this.#limit = limit;
  }

  async acquire(signal) {
    signal?.throwIfAborted();
    if (this.#active < this.#limit) {
      this.#active++;
      return this.#releaser();
    }
    await new Promise((resolve, reject) => {
      const entry = { resolve, signal, onAbort: null };
      entry.onAbort = () => {
        this.#waiting = this.#waiting.filter(item => item !== entry);
        reject(signal.reason);
      };
      signal?.addEventListener("abort", entry.onAbort, { once: true });
      this.#waiting.push(entry);
    });
    return this.#releaser();
  }

  // 名额直接交给排在最前的等待者；没人等才真正减少占用数。
  #releaser() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiting.shift();
      if (next) {
        next.signal?.removeEventListener("abort", next.onAbort);
        next.resolve();
      } else {
        this.#active--;
      }
    };
  }

  get stats() {
    return { limit: this.#limit, active: this.#active, waiting: this.#waiting.length };
  }
}

// 整个后端进程共用一个闸门：不论哪次运行、哪个子任务，同时读取的模型响应都不超过上限。
export const modelGate = new ModelGate(runLimits.modelConcurrency);