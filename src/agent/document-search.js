// src/agent/document-search.js
import { AgentRunError } from "./run-policy.js";
import { cosineSimilarity, assertVector } from "./vector-math.js";
import { citationRef } from "./citations.js";

export const NO_EVIDENCE = "资料中没有找到足够相关的内容。请如实告诉用户资料不足，不要编造，也不要标注引用。";

export async function searchDocuments(store, index, query, embedding, { topK = 4, threshold = 0.5 } = {}) {
    if (typeof query !== "string" || !query.trim()) {
        throw new AgentRunError("INVALID_QUERY", "检索词不能为空。");
    }
    index.prune(store, embedding);
    const docs = store.list();
    if (docs.length === 0) return { results: [], notice: NO_EVIDENCE };

    const slots = await index.vectorsFor(docs, embedding);
    const queryVector = await embedding.embed(query);
    assertVector(queryVector, embedding.dimensions);
    const current = new Map(store.list().map(doc => [doc.id, doc.version]));
    const scored = slots
        .filter(slot => current.get(slot.doc.id) === slot.doc.version)
        .map(slot => ({ slot, score: cosineSimilarity(queryVector, slot.vector) }))
        .sort((a, b) => b.score - a.score);
    console.table(scored.slice(0, 8).map(({ slot, score }) => ({
        name: slot.doc.name, chunk: slot.chunk.index, heading: slot.chunk.heading, score: score.toFixed(3)
    })));

    const results = scored
        .filter(item => item.score >= threshold)
        .slice(0, topK)
        .map(({ slot, score }) => ({
            ref: citationRef(slot.doc, slot.chunk),
            name: slot.doc.name,
            version: slot.doc.version,
            lines: `${slot.chunk.startLine}-${slot.chunk.endLine}`,
            heading: slot.chunk.heading,
            score: Number(score.toFixed(3)),
            text: slot.chunk.text
        }));
    return results.length > 0 ? { results } : { results: [], notice: NO_EVIDENCE };
}