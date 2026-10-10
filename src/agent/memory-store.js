
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AgentRunError } from "./run-policy.js";

export class MemoryStore {
  #filePath;
  constructor(filePath) { this.#filePath = filePath; }
  get filePath() { return this.#filePath; }

  #validateInput(input) {
    for (const field of ["scope", "key", "sourceId", "content"]) {
      if (typeof input?.[field] !== "string" || !input[field].trim()) {
        throw new AgentRunError("INVALID_MEMORY", `${field} 必须是非空文字。`);
      }
    }

    if (!["preference", "fact", "episode"].includes(input.kind)) {
      throw new AgentRunError("INVALID_MEMORY", "kind 只能是 preference、fact 或 episode。");
    }
  }
  #read() {
    if (!fs.existsSync(this.#filePath)) return [];
    try {
      const rows = JSON.parse(fs.readFileSync(this.#filePath, "utf8"));
      if (!Array.isArray(rows)) throw new Error("不是列表");
      const ids = new Set(), slots = new Set();
      for (const row of rows) {
        this.#validateInput(row);
        const slot = JSON.stringify([row.scope, row.key]);
        if (typeof row.id !== "string" || !row.id || !Number.isInteger(row.version) || row.version < 1 ||
            !["active", "deleted"].includes(row.status) || ids.has(row.id) || slots.has(slot)) throw new Error("记录无效");
        ids.add(row.id); slots.add(slot);
      }
      return rows;
    } catch {
      throw new AgentRunError("MEMORY_STORE_INVALID", "记忆文件损坏，停止操作；不要把它当成空列表覆盖。");
    }
  }
  list(scope, includeDeleted = false) {
    const rows = this.#read().filter(row => row.scope === scope);
    return structuredClone(includeDeleted ? rows : rows.filter(row => row.status === "active"));
  }

  #write(rows) {
    fs.mkdirSync(path.dirname(this.#filePath), { recursive: true });
    const temporary = `${this.#filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(rows, null, 2), "utf8");
    fs.renameSync(temporary, this.#filePath);
  }

  remember(input) {
    this.#validateInput(input);
    const rows = this.#read();
    const existing = rows.find(row => row.scope === input.scope && row.key === input.key);
    if (existing?.status === "deleted") throw new AgentRunError("MEMORY_DELETED", "该 key 已删除；旧写入不能恢复它，请使用明确的 restore 操作。");
    if (existing) {
      if (existing.content === input.content && existing.kind === input.kind && existing.sourceId === input.sourceId) return structuredClone(existing);
      throw new AgentRunError("MEMORY_EXISTS", "该 key 已有记录，请带 id 和 version 更新。");
    }

    const { scope, key, sourceId, content, kind } = input;
    const record = { id: randomUUID(), scope, key, sourceId, content, kind, version: 1, status: "active" };
    rows.push(record);
    this.#write(rows);
    return structuredClone(record);
  }

  #change(id, version, scope, patch, requiredStatus = "active") {
    const rows = this.#read();
    const current = rows.find(row => row.id === id && row.scope === scope);
    if (!current || current.status !== requiredStatus) throw new AgentRunError("MEMORY_NOT_FOUND", "当前作用域中没有符合状态的记忆。");

    if (!Number.isInteger(version) || version !== current.version) throw new AgentRunError("MEMORY_VERSION_CONFLICT", "记忆已变化，请重新查看 id 与 version 后操作。");
    const next = { ...current, ...patch, version: current.version + 1 };
    this.#validateInput(next);

    this.#write(rows.map(row => row.id === id ? next : row));
    return structuredClone(next);


  }

  update(id, content, version, scope) {
    return this.#change(id, version, scope, { content });
  }

  remove(id, version, scope) {
    return this.#change(id, version, scope, { status: "deleted" });
  }

  restore(id, version, scope) {
    return this.#change(id, version, scope, { status: "active" }, "deleted");
  }
}