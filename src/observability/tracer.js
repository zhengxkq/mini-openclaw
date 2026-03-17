// src/observability/tracer.js
import fs from "fs";
import path from "path";
import os from "os";
import { paths } from "../config/paths.js";

export class Tracer {
  #traceId;
  #spans = [];
  #activeSpans = new Map(); // spanId → startTime
  #logFile;

  constructor(traceId) {
    this.#traceId = traceId;

    const traceDir = paths.tracesDir;
    fs.mkdirSync(traceDir, { recursive: true });
    this.#logFile = path.join(traceDir, `${traceId}.json`);
  }

  // 开始一个步骤
  startSpan(name, metadata = {}) {
    const spanId = `${name}-${Date.now()}`;
    this.#activeSpans.set(spanId, {
      name,
      startTime: Date.now(),
      metadata
    });
    return spanId;
  }

  // 结束一个步骤
  endSpan(spanId, result = {}) {
    const span = this.#activeSpans.get(spanId);
    if (!span) return;

    const duration = Date.now() - span.startTime;
    const completed = {
      spanId,
      name: span.name,
      duration,
      metadata: span.metadata,
      result,
      status: result.error ? "error" : "ok"
    };

    this.#spans.push(completed);
    this.#activeSpans.delete(spanId);

    console.log(`[Trace:${this.#traceId.slice(-6)}] ${span.name} ${duration}ms ${result.error ? "❌" : "✅"}`);

    return completed;
  }

  // 保存完整 trace 到文件
  save(summary = {}) {
    const trace = {
      traceId: this.#traceId,
      startTime: this.#spans[0]?.metadata?.startTime ?? new Date().toISOString(),
      totalDuration: this.#spans.reduce((sum, s) => sum + s.duration, 0),
      spanCount: this.#spans.length,
      summary,
      spans: this.#spans
    };

    fs.writeFileSync(this.#logFile, JSON.stringify(trace, null, 2));
    return trace;
  }

  get traceId() { return this.#traceId; }
}

// 生成 trace ID
export function generateTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}