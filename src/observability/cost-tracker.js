// src/observability/cost-tracker.js
import fs from "fs";
import { paths } from "../config/paths.js";
// 各模型的价格（元/千token，参考价格，以官网为准）
const MODEL_PRICES = {
  "qwen-max":   { input: 0.04, output: 0.12 },
  "qwen-plus":  { input: 0.008, output: 0.02 },
  "qwen-turbo": { input: 0.003, output: 0.006 },
};

export class CostTracker {
  #filePath;
  #todayKey;
  #data;

  constructor() {
    this.#filePath = paths.costsFile;
    this.#todayKey = new Date().toISOString().slice(0, 10);
    this.#data = this.#load();
  }

  // 记录一次 API 调用的费用
  record({ model, inputTokens, outputTokens, sessionId, operation }) {
    const price = MODEL_PRICES[model] ?? { input: 0.04, output: 0.12 };
    const inputCost  = (inputTokens  / 1000) * price.input;
    const outputCost = (outputTokens / 1000) * price.output;
    const totalCost  = inputCost + outputCost;

    // 确保今天的数据存在
    if (!this.#data[this.#todayKey]) {
      this.#data[this.#todayKey] = {
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        callCount: 0,
        bySession: {},
        byOperation: {}
      };
    }

    const today = this.#data[this.#todayKey];
    today.totalCost         += totalCost;
    today.totalInputTokens  += inputTokens;
    today.totalOutputTokens += outputTokens;
    today.callCount         += 1;

    // 按 session 统计
    if (sessionId) {
      if (!today.bySession[sessionId]) {
        today.bySession[sessionId] = { cost: 0, calls: 0 };
      }
      today.bySession[sessionId].cost  += totalCost;
      today.bySession[sessionId].calls += 1;
    }

    // 按操作类型统计（agent_loop / heartbeat / summarize 等）
    if (operation) {
      if (!today.byOperation[operation]) {
        today.byOperation[operation] = { cost: 0, calls: 0 };
      }
      today.byOperation[operation].cost  += totalCost;
      today.byOperation[operation].calls += 1;
    }

    this.#save();
    return { inputCost, outputCost, totalCost };
  }

  // 获取今日费用摘要
  getTodaySummary() {
    const today = this.#data[this.#todayKey];
    if (!today) {
      return { totalCost: 0, callCount: 0, totalTokens: 0 };
    }
    return {
      date: this.#todayKey,
      totalCost: today.totalCost.toFixed(6),
      totalCostYuan: `¥${today.totalCost.toFixed(4)}`,
      callCount: today.callCount,
      totalTokens: today.totalInputTokens + today.totalOutputTokens,
      inputTokens: today.totalInputTokens,
      outputTokens: today.totalOutputTokens,
      bySession: today.bySession,
      byOperation: today.byOperation
    };
  }

  // 获取最近 N 天的费用
  getRecentDays(n = 7) {
    return Object.entries(this.#data)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, n)
      .map(([date, data]) => ({
        date,
        totalCost: `¥${data.totalCost.toFixed(4)}`,
        callCount: data.callCount,
        totalTokens: data.totalInputTokens + data.totalOutputTokens
      }));
  }

  // 检查是否超过每日预算
  checkBudget(limitYuan = 10) {
    const today = this.#data[this.#todayKey];
    if (!today) return { exceeded: false, current: 0, limit: limitYuan };

    const exceeded = today.totalCost > limitYuan;
    if (exceeded) {
      console.error(`[CostTracker] ⚠️ 今日费用 ¥${today.totalCost.toFixed(4)} 已超过预算 ¥${limitYuan}`);
    }
    return {
      exceeded,
      current: today.totalCost,
      limit: limitYuan,
      remaining: Math.max(0, limitYuan - today.totalCost)
    };
  }

  #load() {
    if (!fs.existsSync(this.#filePath)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.#filePath, "utf-8"));
    } catch { return {}; }
  }

  #save() {
    fs.writeFileSync(this.#filePath, JSON.stringify(this.#data, null, 2));
  }
}

// 全局单例
export const costTracker = new CostTracker();