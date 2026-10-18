// src/agent/document-search.js
import { AgentRunError } from "./run-policy.js";
import { cosineSimilarity, assertVector } from "./vector-math.js";
import { citationRef } from "./citations.js";
import { keywordCandidates, fuseRanks, rerankCandidates } from "./document-retrieval.js";

export const NO_EVIDENCE = "资料中没有找到足够相关的内容。请如实告诉用户资料不足，不要编造，也不要标注引用。";

export async function searchDocuments(store, index, query, embedding,
    { topK = 4, threshold = 0.5, mode = "hybrid", debug = false } = {}) {
    if (typeof query !== "string" || !query.trim()) {
        throw new AgentRunError("INVALID_QUERY", "检索词不能为空。");
    }
    if (!["vector", "hybrid"].includes(mode)) {
        throw new AgentRunError("INVALID_QUERY", "检索模式只能是 vector 或 hybrid。");
    }
    index.prune(store, embedding);
    const docs = store.list();
    if (docs.length === 0) return { results: [], notice: NO_EVIDENCE };

    const slots = await index.vectorsFor(docs, embedding);
    const queryVector = await embedding.embed(query);
    assertVector(queryVector, embedding.dimensions);
    index.prune(store, embedding);
    const current = new Map(store.list().map(doc => [doc.id, doc.version]));
    const live = slots.filter(slot => current.get(slot.doc.id) === slot.doc.version);
    const scored = live.map(slot => ({ slot, score: cosineSimilarity(queryVector, slot.vector) }))
        .sort((a, b) => b.score - a.score);
    const vector = scored.filter(item => item.score >= threshold).slice(0, 8);
    const keyword = keywordCandidates(live, query);
    const fused = mode === "vector" ? vector : fuseRanks(vector, keyword);
    const { accepted, rejected } = mode === "vector"
        ? { accepted: fused, rejected: [] } : rerankCandidates(fused, query);

    const results = accepted.slice(0, topK).map(item => {
        const { slot, score } = item;
        return {
            ref: citationRef(slot.doc, slot.chunk), name: slot.doc.name, version: slot.doc.version,
            lines: `${slot.chunk.startLine}-${slot.chunk.endLine}`, heading: slot.chunk.heading,
            score: score === null ? null : Number(score.toFixed(3)), text: slot.chunk.text
        };
    });
    const found = results.length ? { results } : { results: [], notice: NO_EVIDENCE };
    if (debug) {
        const describe = item => ({
            ref: citationRef(item.slot.doc, item.slot.chunk),
            heading: item.slot.chunk.heading, score: item.score ?? null,
            keywordScore: item.keywordScore ?? null, vectorRank: item.vectorRank ?? null,
            keywordRank: item.keywordRank ?? null, fusedScore: item.fusedScore ?? null,
            missingCodes: item.missingCodes ?? []
        });
        found.diagnostics = {
            query, mode, vector: vector.map(describe), keyword: keyword.map(describe),
            fused: fused.map(describe), rejected: rejected.map(describe), selected: results.map(item => item.ref)
        };
    }
    return found;
}