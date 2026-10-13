import { AgentRunError } from "./run-policy.js";

export function cosineSimilarity(a, b) {
    assertVector(a, a?.length);
    assertVector(b, a.length);
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return Math.max(-1, Math.min(1, dot / denominator));
}

export function assertVector(vector, dimensions) {
    if (!Number.isInteger(dimensions) || dimensions < 1 || !Array.isArray(vector) ||
        vector.length !== dimensions || !Array.from(vector).every(value => Number.isFinite(value))) {
        throw new AgentRunError("INVALID_VECTOR", "向量必须是预期维度的有限数值数组。");
    }
    const norm = vector.reduce((sum, value) => sum + value * value, 0);
    if (!Number.isFinite(norm) || norm <= 0) {
        throw new AgentRunError("INVALID_VECTOR", "零向量或无法稳定计算长度的向量不能检索。");
    }
}