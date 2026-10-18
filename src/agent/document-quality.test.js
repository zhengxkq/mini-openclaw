import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocumentStore } from "./document-store.js";
import { DocumentIndex } from "./document-index.js";
import { chunkDocument } from "./document-chunker.js";
import { searchDocuments } from "./document-search.js";
import { searchTerms, keywordCandidates, fuseRanks } from "./document-retrieval.js";
import { gradeRetrieval, gradeAnswer } from "./document-evaluation.js";
import { checkCitations } from "./citations.js";
import { NO_EVIDENCE } from "./document-search.js";

const retrievalCases = JSON.parse(fs.readFileSync(
  new URL("../../samples/evaluation/day08-retrieval-cases.json", import.meta.url), "utf8"
));

function libraryFor(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "my-openclaw-quality-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    store: new DocumentStore(path.join(dir, "documents.json")),
    index: new DocumentIndex(path.join(dir, "document-index.json"))
  };
}

const samplesDir = new URL("../../samples/documents/", import.meta.url);
const incidents = fs.readFileSync(new URL("pinecone-incidents.md", samplesDir), "utf8");

function qualityEmbedding() {
  const vectorOf = text => {
    if (text.includes("INC-2047")) return [1, 0, 0];
    if (text.includes("INC-204：")) return [0.2, 0.98, 0];
    if (text.includes("INC-305")) return [0, 0, 1];
    return [0, 1, 0];
  };
  return {
    dimensions: 3,
    space: "fake-quality-v1",
    embed: async query => query.includes("上一版") || query.includes("回滚")
      ? [0, 0, 1] : [1, 0, 0],
    embedBatch: async texts => texts.map(vectorOf)
  };
}


test("8.1 关键词按完整编号找候选，不把 INC-2047 当成 INC-204", async t => {
  const { store, index } = libraryFor(t);
  const doc = store.save({ name: "pinecone-incidents.md", content: incidents });
  const found = await searchDocuments(store, index, "INC-204", qualityEmbedding(), { mode: "vector" });
  console.log("原搜索返回：", found.results.map(item => item.heading));
  const slots = chunkDocument(doc.content).map(chunk => ({ doc, chunk }));
  const keyword = keywordCandidates(slots, "INC-204");
  console.log("关键词候选：", keyword.map(item => item.slot.chunk.heading));

  assert.equal(keyword.length, 1);
  assert.ok(keyword[0].slot.chunk.heading.includes("INC-204："));
  assert.ok(!keyword[0].slot.chunk.heading.includes("INC-2047"));
  assert.deepEqual(keyword[0].matchedTerms, ["inc-204"]);
});


test("8.1 关键词统一英文大小写，并能匹配中文相邻两字", () => {
  const terms = searchTerms("INC-204，INC-2047 ＣＡＣＨＥ 缓存刷新");
  console.log("提取的词：", terms);
  assert.deepEqual(terms, ["inc-204", "inc-2047", "cache", "缓存", "存刷", "刷新"]);

  const slots = [
    { doc: { id: "a", name: "cache-guide.md", version: 1 },
      chunk: { index: 0, text: "cache reload：缓存刷新后恢复流量。" } },
    { doc: { id: "b", name: "release.md", version: 1 },
      chunk: { index: 0, text: "review：复核发布计划。" } }
  ];
  const keyword = keywordCandidates(slots, "CACHE 缓存刷新");
  console.log("中英词命中：", keyword.map(item => [item.slot.doc.name, item.matchedTerms]));
  assert.equal(keyword.length, 1);
  assert.equal(keyword[0].slot.doc.id, "a");
  assert.equal(keyword[0].keywordScore, 1);
  assert.deepEqual(keywordCandidates(slots, "？"), []);
});


test("8.2 同一块只留一份，双通道候选按名次融合", () => {
  const doc = { id: "rank-doc", version: 1, name: "rank.md" };
  const a = { doc, chunk: { index: 0, heading: "A", text: "A" } };
  const b = { doc, chunk: { index: 1, heading: "B", text: "B" } };
  const vector = [{ slot: a, score: 0.95 }, { slot: b, score: 0.75 }];
  const keyword = [{ slot: b, keywordScore: 1 }];
  const fused = fuseRanks(vector, keyword);
  console.table(fused.map(item => ({
    block: item.slot.chunk.heading,
    vectorRank: item.vectorRank,
    keywordRank: item.keywordRank,
    fusedScore: item.fusedScore.toFixed(6)
  })));

  assert.equal(fused.length, 2);
  assert.equal(fused[0].slot.chunk.heading, "B");
  assert.equal(fused.filter(item => item.slot.chunk.index === 1).length, 1);
  assert.equal(fused[0].vectorRank, 2);
  assert.equal(fused[0].keywordRank, 1);
  assert.equal(fused[0].score, 0.75);
  assert.ok(Math.abs(fused[0].fusedScore - (1 / 62 + 1 / 61)) < 1e-12);
  assert.equal(fused[1].keywordRank, null);
});


test("8.2 混合搜索把向量漏掉的完整编号送进结果", async t => {
  const { store, index } = libraryFor(t);
  store.save({ name: "pinecone-incidents.md", content: incidents });
  const found = await searchDocuments(store, index, "INC-204", qualityEmbedding(), { mode: "hybrid" });
  console.log("混合搜索返回：", found.results.map(item => item.heading));

  assert.ok(found.results.some(item => item.heading.includes("INC-204：")));
  assert.ok(found.results.every(item => typeof item.ref === "string" && item.ref.startsWith("doc-")));
});


test("8.3 明确问 INC-204，就不能把 INC-2047 排在前面", async t => {
  const { store, index } = libraryFor(t);
  store.save({ name: "pinecone-incidents.md", content: incidents });
  const found = await searchDocuments(store, index, "INC-204", qualityEmbedding());
  console.table(found.results.map(item => ({ heading: item.heading, score: item.score })));
  assert.equal(found.results[0].heading,
    "松果项目故障索引 > INC-204：发布后缓存没有刷新");
  assert.ok(found.results.every(item => !item.heading.includes("INC-2047")));
  assert.ok(found.results.length <= 4);
});

test("8.3 没有 INC-9999，说明不足并保留淘汰原因", async t => {
  const { store, index } = libraryFor(t);
  store.save({ name: "pinecone-incidents.md", content: incidents });
  const found = await searchDocuments(store, index, "INC-9999", qualityEmbedding(), { debug: true });
  console.log("没有这个编号：", found);
  assert.deepEqual(found.results, []);
  assert.ok(found.notice.includes("资料不足"));
  assert.deepEqual(found.diagnostics.rejected[0].missingCodes, ["inc-9999"]);
});

test("8.4 同一组固定问题比较纯向量与混合检索", async t => {
  const { store, index } = libraryFor(t);
  store.save({ name: "pinecone-incidents.md", content: incidents });
  const embedding = qualityEmbedding();
  const rows = [];
  for (const mode of ["vector", "hybrid"]) {
    for (const sample of retrievalCases) {
      const found = await searchDocuments(store, index, sample.query, embedding,
        { mode, topK: 1 });
      const grade = gradeRetrieval(found.results, sample.expected);
      rows.push({ mode, id: sample.id, actual: found.results[0]?.heading ?? "空结果", ...grade });
      if (mode === "hybrid") assert.ok(grade.passed, `${sample.id} 没有找到指定依据`);
    }
  }
  console.table(rows);
  const count = mode => rows.filter(row => row.mode === mode && row.passed).length;
  console.log("vector:", `${count("vector")}/${retrievalCases.length}`);
  console.log("hybrid:", `${count("hybrid")}/${retrievalCases.length}`);
  assert.equal(count("vector"), 2);
  assert.equal(count("hybrid"), 4);
});

function qualityRun(found) {
  return [
    { role: "user", content: "INC-204 由谁负责，处理动作是什么？" },
    { role: "assistant", content: null, tool_calls: [{ id: "quality-search-1", type: "function",
      function: { name: "search_documents", arguments: '{"query":"INC-204"}' } }] },
    { role: "tool", tool_call_id: "quality-search-1", content: JSON.stringify(found) }
  ];
}

test("8.5 合法出处不能替错误结论通过样本检查", async t => {
  const { store, index } = libraryFor(t);
  store.save({ name: "pinecone-incidents.md", content: incidents });
  const found = await searchDocuments(store, index, "INC-204", qualityEmbedding(),
    { mode: "hybrid", topK: 1 });
  const ref = found.results[0].ref;
  const answer = `由小周负责，只修订告警阈值 [${ref}]。`;
  const messages = qualityRun(found);
  const verdict = gradeAnswer({ answer, messages,
    requiredFacts: ["小林", "./ops/cache.sh flush"],
    forbiddenFacts: ["小周", "只修订告警阈值"] });
  console.log("原文：", found.results[0].text);
  console.log("错误回答的评分：", verdict);
  assert.equal(checkCitations({ answer, messages }).action, "accept");
  assert.deepEqual(verdict, { citationOk: true,
    missingFacts: ["小林", "./ops/cache.sh flush"],
    unexpectedFacts: ["小周", "只修订告警阈值"], passed: false });
});

test("8.5 原文事实配对正确时样本检查通过", async t => {
  const { store, index } = libraryFor(t);
  store.save({ name: "pinecone-incidents.md", content: incidents });
  const found = await searchDocuments(store, index, "INC-204", qualityEmbedding(),
    { mode: "hybrid", topK: 1 });
  const ref = found.results[0].ref;
  const answer = `由小林负责，执行 ./ops/cache.sh flush [${ref}]。`;
  const verdict = gradeAnswer({ answer, messages: qualityRun(found),
    requiredFacts: ["小林", "./ops/cache.sh flush"],
    forbiddenFacts: ["小周", "只修订告警阈值"] });
  console.log("正确回答的评分：", verdict);
  assert.deepEqual(verdict, { citationOk: true, missingFacts: [], unexpectedFacts: [], passed: true });
});

function qualityModel(client, rounds) {
  const original = client.chat.completions.create;
  let round = 0;
  client.chat.completions.create = async () => {
    const step = rounds[round++];
    if (!step) throw new Error("测试剧本没有下一轮");
    return (async function* () {
      if (step.text) yield { choices: [{ delta: { content: step.text }, finish_reason: null }] };
      for (const [i, call] of (step.calls ?? []).entries()) {
        yield { choices: [{ delta: { tool_calls: [{ index: i, id: call.id,
          function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: null }] };
      }
      yield { choices: [{ delta: {}, finish_reason: step.calls ? "tool_calls" : "stop" }] };
    })();
  };
  return () => { client.chat.completions.create = original; };
}

test("8.6 旧任务的出处不能替代当前任务的检索", async t => {
  process.env.DASHSCOPE_API_KEY ||= "offline-test";
  process.env.BASE_URL ||= "http://127.0.0.1:9";
  process.env.MODEL ||= "offline-test";
  const { runAgentLoop } = await import("./loop.js");
  const { client } = await import("../client.js");
  const { store, index } = libraryFor(t);
  store.save({ name: "pinecone-incidents.md", content: incidents });
  const found = await searchDocuments(store, index, "INC-204", qualityEmbedding());
  const ref = found.results[0].ref;
  const messages = [{ role: "system", content: "test" }, ...qualityRun(found),
    { role: "assistant", content: `负责人是小林 [${ref}]。` },
    { role: "user", content: "现在的负责人是谁？请查资料确认。" }];
  const executed = [];
  t.after(qualityModel(client, [
    { text: `负责人是小林 [${ref}]。` },
    { calls: [{ id: "quality-current", name: "search_documents", args: { query: "INC-204" } }] },
    { text: `本次重新查到，负责人是小林 [${ref}]。` }
  ]));
  const answer = await runAgentLoop(messages, () => {}, () => {}, async name => {
    executed.push(name);
    return JSON.stringify(found);
  }, { checkCompletion: checkCitations });
  console.log("当前任务执行的工具：", executed, "回答：", answer);
  assert.deepEqual(executed, ["search_documents"]);
  assert.ok(answer.includes("本次重新查到"));
});

test("8.6 当前检索为空，必须说明资料不足；普通聊天照常", () => {
  const messages = qualityRun({ results: [], notice: NO_EVIDENCE });
  const fabricated = checkCitations({ answer: "今年预算是一百万元。", messages });
  console.log("没有依据的回答：", fabricated.action);
  assert.equal(fabricated.action, "continue");
  assert.equal(checkCitations({ answer: "资料不足，无法确认预算。", messages }).action, "accept");
  assert.equal(checkCitations({ answer: "你好！", messages: [{ role: "user", content: "你好" }] }).action,
    "accept");
});

test("8.6 索引生成等待期间删除，旧块不交付也不留在本次索引", async t => {
  const { store, index } = libraryFor(t);
  const doc = store.save({ name: "pinecone-incidents.md", content: incidents });
  const base = qualityEmbedding();
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const slow = { ...base, embedBatch: async texts => {
    entered();
    await gate;
    return base.embedBatch(texts);
  } };
  const pending = searchDocuments(store, index, "INC-204", slow);
  await started;
  store.remove(doc.id, doc.version);
  release();
  const found = await pending;
  const cached = JSON.parse(fs.readFileSync(index.filePath, "utf8")).entries;
  console.log("等待期间删除：", found.results.length, "缓存条数：", cached.length);
  assert.deepEqual(found.results, []);
  assert.equal(cached.length, 0);
});