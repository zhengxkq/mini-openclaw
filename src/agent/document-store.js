import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AgentRunError } from "./run-policy.js";

const MAX_DOCUMENT_CHARS = 200_000;

export class DocumentStore {
  #filePath;
  constructor(filePath) { this.#filePath = filePath; }
  get filePath() { return this.#filePath; }

  #validate(name, content) {
    if (typeof name !== "string" || !/^[^/\\]{1,100}\.(md|txt)$/i.test(name)) {
      throw new AgentRunError("INVALID_DOCUMENT", "只接受 100 字以内、以 .md 或 .txt 结尾的文件名。");
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new AgentRunError("INVALID_DOCUMENT", "资料内容不能为空。");
    }
    if (content.length > MAX_DOCUMENT_CHARS || content.includes("\u0000")) {
      throw new AgentRunError("INVALID_DOCUMENT", "资料超过 20 万字，或不是纯文本。");
    }
  }

  #read() {
    if (!fs.existsSync(this.#filePath)) return [];
    try {
      const rows = JSON.parse(fs.readFileSync(this.#filePath, "utf8"));
      if (!Array.isArray(rows)) throw new Error("不是列表");
      const ids = new Set();
      for (const row of rows) {
        if (typeof row?.id !== "string" || ids.has(row.id) || typeof row.name !== "string" ||
            typeof row.content !== "string" || !Number.isInteger(row.version) || row.version < 1 ||
            !["active", "deleted"].includes(row.status)) throw new Error("记录无效");
        ids.add(row.id);
      }
      return rows;
    } catch {
      throw new AgentRunError("DOCUMENT_STORE_INVALID", "资料文件损坏，停止操作；不要把它当成空列表覆盖。");
    }
  }

  #write(rows) {
    fs.mkdirSync(path.dirname(this.#filePath), { recursive: true });
    const temporary = this.#filePath + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temporary, JSON.stringify(rows, null, 2), "utf8");
      fs.renameSync(temporary, this.#filePath);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  list() {
    return structuredClone(this.#read().filter(row => row.status === "active"));
  }

  get(id) {
    return structuredClone(this.#read().find(row => row.id === id) ?? null);
  }

  save({ name, content } = {}) {
    this.#validate(name, content);
    const rows = this.#read();
    const current = rows.find(row => row.status === "active" && row.name === name);
    if (current?.content === content) return structuredClone(current);

    const importedAt = new Date().toISOString();
    if (current) {
      const next = { ...current, content, version: current.version + 1, importedAt };
      this.#write(rows.map(row => row.id === current.id ? next : row));
      return structuredClone(next);
    }
    let id;
    do { id = randomUUID().slice(0, 8); } while (rows.some(row => row.id === id));
    const record = { id, name, content, version: 1, status: "active", importedAt };
    this.#write([...rows, record]);
    return structuredClone(record);
  }

  remove(id, version) {
    const rows = this.#read();
    const current = rows.find(row => row.id === id && row.status === "active");
    if (!current) throw new AgentRunError("DOCUMENT_NOT_FOUND", "没有这份有效资料。");
    if (version !== current.version) {
      throw new AgentRunError("DOCUMENT_VERSION_CONFLICT", "资料已变化，请刷新列表后再删除。");
    }
    const next = { ...current, content: "", version: current.version + 1, status: "deleted" };
    this.#write(rows.map(row => row.id === id ? next : row));
    return structuredClone(next);
  }
}