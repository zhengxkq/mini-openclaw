// src/agent/citations.js
import { AgentRunError } from "./run-policy.js";
import { chunkDocument } from "./document-chunker.js";

const CITATION = /\[(doc-[0-9a-f]{8}-v\d+-c\d+)\]/g;

export function citationRef(doc, chunk) {
    return `doc-${doc.id}-v${doc.version}-c${chunk.index}`;
}

export function parseCitation(ref) {
    const match = /^doc-([0-9a-f]{8})-v(\d+)-c(\d+)$/.exec(ref ?? "");
    return match ? { docId: match[1], version: Number(match[2]), index: Number(match[3]) } : null;
}

export function citedRefs(answer) {
    return [...new Set([...answer.matchAll(CITATION)].map(match => match[1]))];
}

export function searchedRefs(messages) {
    const callIds = new Set(messages
        .flatMap(message => message.role === "assistant" ? message.tool_calls ?? [] : [])
        .filter(call => call.function?.name === "search_documents")
        .map(call => call.id));
    const refs = new Set();
    for (const message of messages) {
        if (message.role !== "tool" || !callIds.has(message.tool_call_id)) continue;
        try {
            for (const result of JSON.parse(message.content).results ?? []) refs.add(result.ref);
        } catch {
            // 不是 JSON 的工具结果里没有出处
        }
    }
    return refs;
}

export function checkCitations({ answer, messages }) {
    const searched = searchedRefs(messages);
    const cited = citedRefs(answer);
    const unknown = cited.filter(ref => !searched.has(ref));
    if (unknown.length > 0) {
        return {
            action: "continue", followUp: `回答里的出处 ${unknown.join("、")} 不在本次 search_documents 的结果里。` +
                "只能原样使用结果中的 ref；没有依据的句子请删掉。"
        };
    }
    if (searched.size > 0 && cited.length === 0 && !answer.includes("资料不足")) {
        return {
            action: "continue", followUp: "本次查到了资料，但回答没有标注出处。" +
                "请在用到资料的句子后面加上对应的 [ref]；资料用不上就说明资料不足。"
        };
    }
    return { action: "accept" };
}

export function resolveSource(store, ref) {
    const cite = parseCitation(ref);
    if (!cite) throw new AgentRunError("INVALID_CITATION", "出处格式不对。");
    const doc = store.get(cite.docId);
    if (doc?.status === "deleted") {
        throw new AgentRunError("SOURCE_DELETED", `「${doc.name}」已删除，这个出处不再可用。`);
    }
    if (doc && doc.version !== cite.version) {
        throw new AgentRunError("SOURCE_OUTDATED",
            `这个出处来自 v${cite.version}，「${doc.name}」已更新到 v${doc.version}，旧原文不再保留。请重新提问。`);
    }
    const chunk = doc ? chunkDocument(doc.content)[cite.index] : undefined;
    if (!chunk) throw new AgentRunError("SOURCE_NOT_FOUND", "找不到这个出处。");
    return {
        ref, name: doc.name, version: doc.version,
        lines: `${chunk.startLine}-${chunk.endLine}`, heading: chunk.heading, text: chunk.text
    };
}