// src/agent/document-index.js
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AgentRunError } from "./run-policy.js";
import { assertVector } from "./vector-math.js";
import { chunkDocument } from "./document-chunker.js";

const BATCH_SIZE = 10;
const slotKey = entry => JSON.stringify([entry.docId, entry.version, entry.index, entry.space]);

export class DocumentIndex {
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
                if (typeof entry?.docId !== "string" || typeof entry.text !== "string" ||
                    typeof entry.space !== "string" || !Number.isInteger(entry.version) ||
                    !Number.isInteger(entry.index)) throw new Error("索引字段无效");
                assertVector(entry.vector, entry.dimensions);
                if (slots.has(slotKey(entry))) throw new Error("索引条目重复");
                slots.add(slotKey(entry));
            }
            return index;
        } catch {
            throw new AgentRunError("DOCUMENT_INDEX_INVALID", "资料索引损坏，停止检索；保留原文件供检查。");
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

    #save(slots, vectors, embedding) {
        const entries = slots.map((slot, i) => {
            assertVector(vectors?.[i], embedding.dimensions);
            slot.vector = structuredClone(vectors[i]);
            return {
                docId: slot.doc.id, version: slot.doc.version, index: slot.chunk.index, text: slot.chunk.text,
                space: embedding.space, dimensions: embedding.dimensions, vector: slot.vector
            };
        });
        const fresh = new Set(entries.map(slotKey));
        const current = this.#read();
        current.entries = current.entries.filter(entry => !fresh.has(slotKey(entry)));
        current.entries.push(...entries);
        this.#write(current);
    }
    prune(store, embedding) {
        this.#assertEmbedding(embedding);
        const index = this.#read();
        const current = new Map(store.list().map(doc => [doc.id, doc.version]));
        const entries = index.entries.filter(entry =>
            current.get(entry.docId) === entry.version &&
            entry.space === embedding.space && entry.dimensions === embedding.dimensions);
        if (entries.length !== index.entries.length) this.#write({ schema: 1, entries });
    }

    async vectorsFor(docs, embedding) {
        this.#assertEmbedding(embedding);
        const index = this.#read();
        const slots = [];
        const missing = [];
        for (const doc of docs) {
            for (const chunk of chunkDocument(doc.content)) {
                const hit = index.entries.find(entry =>
                    entry.docId === doc.id && entry.version === doc.version && entry.index === chunk.index &&
                    entry.text === chunk.text && entry.space === embedding.space &&
                    entry.dimensions === embedding.dimensions);
                const slot = { doc, chunk, vector: hit ? structuredClone(hit.vector) : null };
                slots.push(slot);
                if (!hit) missing.push(slot);
            }
        }
        for (let start = 0; start < missing.length; start += BATCH_SIZE) {
            const batch = missing.slice(start, start + BATCH_SIZE);
            const vectors = await embedding.embedBatch(batch.map(slot => slot.chunk.text));
            this.#save(batch, vectors, embedding);
        }
        return slots;
    }
}