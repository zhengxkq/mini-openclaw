import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AgentRunError } from "./run-policy.js";
import { assertVector } from "./vector-math.js";

export class EpisodeIndex {
  #filePath;
  constructor(filePath) { this.#filePath = filePath; }
  get filePath() { return this.#filePath; }

  #assertEmbedding(embedding) {
    if (typeof embedding?.space !== "string" || !embedding.space.trim() ||
        !Number.isInteger(embedding.dimensions) || embedding.dimensions < 1) {
      throw new AgentRunError("EMBEDDING_CONFIG", "索引需要明确的向量空间和正整数维度。");
    }
  }
    #read() {
    if (!fs.existsSync(this.#filePath)) return { schema: 1, entries: [] };
    try {
      const index = JSON.parse(fs.readFileSync(this.#filePath, "utf8"));
      if (!index || index.schema !== 1 || !Array.isArray(index.entries)) throw new Error("索引外壳无效");
      const slots = new Set();
      for (const entry of index.entries) {
        for (const field of ["id", "scope", "key", "content", "space"]) {
          if (typeof entry?.[field] !== "string" || !entry[field].trim()) throw new Error("索引字段无效");
        }
        if (!Number.isInteger(entry.version) || entry.version < 1) throw new Error("索引版本无效");
        assertVector(entry.vector, entry.dimensions);
        const slot = JSON.stringify([entry.id, entry.space]);
        if (slots.has(slot)) throw new Error("索引条目重复");
        slots.add(slot);
      }
      return index;
    } catch {
      throw new AgentRunError("EPISODE_INDEX_INVALID", "事件索引损坏，停止复用；保留原文件供检查。");
    }
  }

    #write(index) {
    fs.mkdirSync(path.dirname(this.#filePath), { recursive: true });
    const temporary = this.#filePath + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temporary, JSON.stringify(index, null, 2), "utf8");
      fs.renameSync(temporary, this.#filePath);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

    prune(store, embedding) {
    this.#assertEmbedding(embedding);
    const index = this.#read();
    const activeByScope = new Map();
    const entries = index.entries.filter(entry => {
      if (entry.space !== embedding.space || entry.dimensions !== embedding.dimensions) return false;
      if (!activeByScope.has(entry.scope)) {
        activeByScope.set(entry.scope, store.list(entry.scope));
      }
      return activeByScope.get(entry.scope).some(row =>
        row.kind === "episode" && row.id === entry.id && row.key === entry.key &&
        row.version === entry.version && row.content === entry.content);
    });
    if (entries.length !== index.entries.length) this.#write({ schema: 1, entries });
  }

    async vectorFor(row, embedding) {
    this.#assertEmbedding(embedding);
    const index = this.#read();
    const hit = index.entries.find(entry =>
      entry.id === row.id && entry.scope === row.scope && entry.key === row.key &&
      entry.version === row.version && entry.content === row.content &&
      entry.space === embedding.space && entry.dimensions === embedding.dimensions);
    if (hit) return structuredClone(hit.vector);

    const vector = await embedding.embed(row.content);
    assertVector(vector, embedding.dimensions);
    const current = this.#read();
    const entry = {
      id: row.id, scope: row.scope, key: row.key, version: row.version,
      content: row.content, space: embedding.space, dimensions: embedding.dimensions,
      vector: structuredClone(vector)
    };
    current.entries = current.entries.filter(item => item.id !== row.id);
    current.entries.push(entry);
    this.#write(current);
    return structuredClone(vector);
  }
}