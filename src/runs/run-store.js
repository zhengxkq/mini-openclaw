// src/runs/run-store.js
import fs from "node:fs";
import path from "node:path";

const SAFE_RUN_ID = /^[0-9a-f-]{36}$/;

export class RunStore {
    #dir;
    #lastSeq = new Map();

    constructor(dir) {
        this.#dir = dir;
        fs.mkdirSync(dir, { recursive: true });
    }

    append(runId, record) {
        const seq = (this.#lastSeq.get(runId) ?? this.read(runId).at(-1)?.seq ?? 0) + 1;
        const line = { ...record, seq };
        fs.appendFileSync(this.#file(runId), JSON.stringify(line) + "\n");
        this.#lastSeq.set(runId, seq);
        return line;
    }

    // 进程在写一行时被杀，最后一行可能不完整；只丢掉坏掉的那一行。
    read(runId) {
        const file = this.#file(runId);
        if (!fs.existsSync(file)) return [];
        const records = [];
        for (const line of fs.readFileSync(file, "utf8").split("\n")) {
            if (!line.trim()) continue;
            try { records.push(JSON.parse(line)); } catch { break; }
        }
        return records;
    }

    listForSession(sessionId, limit = 20) {
        return this.#allRuns()
            .filter(records => records[0]?.sessionId === sessionId)
            .sort((a, b) => a[0].at.localeCompare(b[0].at))
            .slice(-limit);
    }

    unfinishedRunIds() {
        return this.#allRuns()
            .filter(records => records.at(-1)?.type !== "run_finished")
            .map(records => records[0].runId);
    }

    #allRuns() {
        return fs.readdirSync(this.#dir)
            .filter(name => name.endsWith(".jsonl"))
            .map(name => this.read(name.slice(0, -".jsonl".length)))
            .filter(records => records[0]?.type === "run_started");
    }

    #file(runId) {
        if (!SAFE_RUN_ID.test(runId)) throw new Error("运行编号格式不对。");
        return path.join(this.#dir, `${runId}.jsonl`);
    }
}