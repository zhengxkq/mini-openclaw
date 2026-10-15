import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocumentStore } from "./document-store.js";
import { chunkDocument } from "./document-chunker.js";
import { DocumentIndex } from "./document-index.js";
import { searchDocuments, NO_EVIDENCE } from "./document-search.js";
import { AgentRunError, prepareToolCalls, assertToolResult } from "./run-policy.js";
import { toolDefinitions } from "./tools.js";
import { checkCitations, resolveSource } from "./citations.js";
import { Sandbox } from "./sandbox.js";


function libraryFor(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "my-openclaw-docs-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return {
        store: new DocumentStore(path.join(dir, "documents.json")),
        index: new DocumentIndex(path.join(dir, "document-index.json"))
    };
}

const storeFor = t => libraryFor(t).store;

const samplesDir = new URL("../../samples/documents/", import.meta.url);
const runbook = fs.readFileSync(new URL("pinecone-runbook.md", samplesDir), "utf8");
const faq = fs.readFileSync(new URL("pinecone-faq.md", samplesDir), "utf8");

const KEYWORDS = ["回滚", "发布", "环境", "迁移", "续签", "告警", "缓存", "流量", "镜像", "数据库", "周五", "负责人", "语言"];

function fakeEmbedding({ failOnCall } = {}) {
    const calls = [];
    const vectorOf = text => [...KEYWORDS.map(word => text.split(word).length - 1), 0.01];
    return {
        calls,
        space: "fake-keywords-v1",
        dimensions: KEYWORDS.length + 1,
        embed: async text => vectorOf(text),
        embedBatch: async texts => {
            if (texts.length > 10) {
                throw new AgentRunError("EMBEDDING_INPUT_INVALID", "本接口每批接受 1 到 10 条非空文字。");
            }
            calls.push(texts.length);
            if (calls.length === failOnCall) {
                throw new AgentRunError("EMBEDDING_UNAVAILABLE", "向量服务本次请求失败。");
            }
            return texts.map(vectorOf);
        }
    };
}

const indexEntries = index => JSON.parse(fs.readFileSync(index.filePath, "utf8")).entries;

test("7.1 同名资料再次导入：内容相同不变，内容不同升版本", t => {
    const store = storeFor(t);
    const first = store.save({ name: "pinecone-runbook.md", content: runbook });
    const again = store.save({ name: "pinecone-runbook.md", content: runbook });
    const changed = store.save({ name: "pinecone-runbook.md", content: runbook + "\n补充一行。\n" });
    console.log("三次导入：", [first, again, changed].map(doc => [doc.id, doc.version]));

    assert.equal(again.version, 1);
    assert.equal(changed.id, first.id);
    assert.equal(changed.version, 2);
    assert.equal(store.list().length, 1);
});

test("7.1 不合格的资料被拒绝，且不创建文件", t => {
    const store = storeFor(t);
    for (const input of [
        { name: "photo.png", content: "x" },
        { name: "../secret.md", content: "x" },
        { name: "empty.md", content: "  \n" },
        { name: "big.md", content: "字".repeat(200_001) }
    ]) {
        assert.throws(() => store.save(input), error => {
            console.log(input.name, "→", error.code, error.message);
            return error.code === "INVALID_DOCUMENT";
        });
    }
    assert.equal(fs.existsSync(store.filePath), false);
});

test("7.1 删除要带当前版本，删除后清空原文", t => {
    const store = storeFor(t);
    const doc = store.save({ name: "pinecone-runbook.md", content: runbook });
    assert.throws(() => store.remove(doc.id, 0), { code: "DOCUMENT_VERSION_CONFLICT" });
    const deleted = store.remove(doc.id, doc.version);
    console.log("删除后：", deleted.status, deleted.version, JSON.stringify(deleted.content));

    assert.deepEqual(store.list(), []);
    assert.equal(deleted.content, "");
    assert.ok(!fs.readFileSync(store.filePath, "utf8").includes("回滚"));
});


test("7.2 代码块里的 # 注释不是标题，回滚命令留在同一块", () => {
    const chunks = chunkDocument(runbook);
    console.table(chunks.map(chunk => ({
        index: chunk.index, lines: `${chunk.startLine}-${chunk.endLine}`, heading: chunk.heading
    })));
    const rollback = chunks.find(chunk => chunk.text.includes("./ops/deploy.sh --image previous"));

    assert.equal(rollback.heading, "松果项目部署手册 > 回滚");
    for (const command of ["traffic.sh pause", "deploy.sh --image previous", "traffic.sh resume"]) {
        assert.ok(rollback.text.includes(command), command);
    }
    assert.ok(chunks.every(chunk => !chunk.heading.includes("先暂停新流量")));
    assert.equal(chunks.at(-1).heading, "松果项目部署手册 > 数据库迁移");
});

test("7.2 每块记下原文行号，太长的段落切成多块", () => {
    const lines = runbook.split("\n");
    for (const chunk of chunkDocument(runbook)) {
        const original = lines.slice(chunk.startLine - 1, chunk.endLine).join("\n");
        const body = chunk.text.slice(chunk.heading.length + 1);
        assert.equal(original.trim(), body.trim(), `第 ${chunk.index} 块`);
    }
    const long = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行：${"内容".repeat(20)}`).join("\n");
    const pieces = chunkDocument(long, { maxChars: 300 });
    console.log("长段落切成", pieces.map(piece => `${piece.startLine}-${piece.endLine}`));
    assert.ok(pieces.length > 1);
    assert.ok(pieces.every(piece => piece.text.length <= 300));
});


test("7.3 资料库为空时直接说明资料不足，不调用向量服务", async t => {
    const { store, index } = libraryFor(t);
    const embedding = fakeEmbedding();
    const found = await searchDocuments(store, index, "怎么回滚", embedding);
    assert.deepEqual(found, { results: [], notice: NO_EVIDENCE });
    assert.deepEqual(embedding.calls, []);
});

test("7.3 回滚问题命中回滚那一块，并带上行号", async t => {
    const { store, index } = libraryFor(t);
    store.save({ name: "pinecone-runbook.md", content: runbook });
    const found = await searchDocuments(store, index, "正式环境出问题怎么回滚", fakeEmbedding());
    console.log(found.results.map(item => [item.heading, item.lines, item.score]));

    assert.equal(found.results[0].heading, "松果项目部署手册 > 回滚");
    assert.equal(found.results[0].lines, "22-35");
    const nothing = await searchDocuments(store, index, "项目用什么编程语言", fakeEmbedding());
    assert.deepEqual(nothing, { results: [], notice: NO_EVIDENCE });
});

test("7.3 超过 10 块的资料分批建立索引", async t => {
    const { store, index } = libraryFor(t);
    const doc = store.save({ name: "pinecone-faq.md", content: faq });
    const embedding = fakeEmbedding();
    const slots = await index.vectorsFor([doc], embedding);
    console.log("块数", slots.length, "每批条数", embedding.calls);

    assert.equal(slots.length, 31);
    assert.deepEqual(embedding.calls, [10, 10, 10, 1]);
    assert.equal(indexEntries(index).length, 31);
});

test("7.3 第二批失败后重试，只补算缺的那几块", async t => {
    const { store, index } = libraryFor(t);
    const doc = store.save({ name: "pinecone-faq.md", content: faq });
    await assert.rejects(index.vectorsFor([doc], fakeEmbedding({ failOnCall: 2 })),
        { code: "EMBEDDING_UNAVAILABLE" });
    console.log("失败后索引里已有", indexEntries(index).length, "条");
      assert.equal(indexEntries(index).length, 10);

    const retry = fakeEmbedding();
    await index.vectorsFor([doc], retry);
    console.log("重试时每批条数", retry.calls);
    assert.deepEqual(retry.calls, [10, 10, 1]);
});


test("7.4 search_documents 已开放，参数检查和其他工具一样严格", () => {
  const call = args => ({ id: "call-1", type: "function",
    function: { name: "search_documents", arguments: JSON.stringify(args) } });
  const [prepared] = prepareToolCalls([call({ query: "怎么回滚" })], toolDefinitions);
  assert.deepEqual(prepared.args, { query: "怎么回滚" });
  assert.throws(() => prepareToolCalls([call({})], toolDefinitions), { code: "INVALID_TOOL_ARGUMENTS" });
  assert.throws(() => prepareToolCalls([call({ query: ["回滚"] })], toolDefinitions),
    { code: "INVALID_TOOL_ARGUMENTS" });
});

test("7.4 资料不足是正常结果，不会被当成工具失败", () => {
  assert.doesNotThrow(() => assertToolResult(JSON.stringify({ results: [], notice: NO_EVIDENCE })));
  assert.throws(() => assertToolResult(JSON.stringify({ error: "工具执行出错: 向量服务本次请求失败" })),
    { code: "TOOL_FAILED" });
});


function searchRun(found, toolName = "search_documents") {
  return [
    { role: "user", content: "怎么回滚？" },
    { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function",
      function: { name: toolName, arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call-1", content: JSON.stringify(found) }
  ];
}

test("7.5 检索结果带可以原样引用的 ref", async t => {
  const { store, index } = libraryFor(t);
  const doc = store.save({ name: "pinecone-runbook.md", content: runbook });
  const found = await searchDocuments(store, index, "正式环境出问题怎么回滚", fakeEmbedding());
  console.log("ref:", found.results.map(item => item.ref));
  assert.equal(found.results[0].ref, `doc-${doc.id}-v1-c3`);
  assert.equal(resolveSource(store, found.results[0].ref).lines, "22-35");
});

test("7.5 验收：引用必须来自本次检索结果", async t => {
  const { store, index } = libraryFor(t);
  store.save({ name: "pinecone-runbook.md", content: runbook });
  const found = await searchDocuments(store, index, "正式环境出问题怎么回滚", fakeEmbedding());
  const ref = found.results[0].ref;
  const messages = searchRun(found);

  const verdicts = {
    "正确引用": checkCitations({ answer: `先暂停流量，再切回上一个镜像 [${ref}]。`, messages }),
    "编造出处": checkCitations({ answer: "切回上一个镜像 [doc-0000beef-v1-c0]。", messages }),
    "查到不标": checkCitations({ answer: "先暂停流量，再切回上一个镜像。", messages }),
    "说资料不足": checkCitations({ answer: "资料不足，手册里没有写这件事。", messages }),
    "没查资料却引用": checkCitations({ answer: `见 [${ref}]。`, messages: messages.slice(0, 1) }),
    "别的工具冒充": checkCitations({ answer: `见 [${ref}]。`, messages: searchRun(found, "web_search") }),
    "闲聊": checkCitations({ answer: "你好！", messages: messages.slice(0, 1) })
  };
  console.table(Object.fromEntries(Object.entries(verdicts).map(([name, v]) => [name, v.action])));

  assert.equal(verdicts["正确引用"].action, "accept");
  assert.equal(verdicts["编造出处"].action, "continue");
  assert.equal(verdicts["查到不标"].action, "continue");
  assert.equal(verdicts["说资料不足"].action, "accept");
  assert.equal(verdicts["没查资料却引用"].action, "continue");
  assert.equal(verdicts["别的工具冒充"].action, "continue");
  assert.equal(verdicts["闲聊"].action, "accept");
});


const runbookV2 = fs.readFileSync(new URL("v2/pinecone-runbook.md", samplesDir), "utf8");

test("7.6 旧出处不能显示新版本的原文", t => {
  const { store } = libraryFor(t);
  const v1 = store.save({ name: "pinecone-runbook.md", content: runbook });
  const oldRef = `doc-${v1.id}-v1-c3`;
  console.log("导入 v2 前：", resolveSource(store, oldRef).text.includes("cache.sh") ? "四步" : "三步");

  const v2 = store.save({ name: "pinecone-runbook.md", content: runbookV2 });
  assert.throws(() => resolveSource(store, oldRef), error => {
    console.log("导入 v2 后：", error.code, error.message);
    return error.code === "SOURCE_OUTDATED";
  });
  assert.ok(resolveSource(store, `doc-${v2.id}-v2-c3`).text.includes("cache.sh"));

  store.remove(v2.id, v2.version);
  assert.throws(() => resolveSource(store, `doc-${v2.id}-v2-c3`), { code: "SOURCE_DELETED" });
});

test("7.6 换版本、删除之后，索引里不再留着旧原文", async t => {
  const { store, index } = libraryFor(t);
  const embedding = fakeEmbedding();
  const v1 = store.save({ name: "pinecone-runbook.md", content: runbook });
  await searchDocuments(store, index, "怎么回滚", embedding);
  const v2 = store.save({ name: "pinecone-runbook.md", content: runbookV2 });
  await searchDocuments(store, index, "怎么回滚", embedding);
  console.log("换版本后索引里的版本：", indexEntries(index).map(entry => entry.version));
  assert.ok(indexEntries(index).every(entry => entry.version === v2.version));

  store.remove(v1.id, v2.version);
  index.prune(store, embedding);
  console.log("删除后索引条数：", indexEntries(index).length);
  assert.equal(indexEntries(index).length, 0);
  assert.ok(!fs.readFileSync(index.filePath, "utf8").includes("回滚"));
});

test("7.6 检索等待向量期间资料被删，结果里不能再出现它", async t => {
  const { store, index } = libraryFor(t);
  const base = fakeEmbedding();
  const doc = store.save({ name: "pinecone-runbook.md", content: runbook });
  await index.vectorsFor([doc], base);

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const slow = { ...base, embed: async text => { await gate; return base.embed(text); } };
  const pending = searchDocuments(store, index, "正式环境出问题怎么回滚", slow);
  store.remove(doc.id, doc.version);
  release();
  const found = await pending;
  console.log("删除后的检索结果：", found.results.map(item => item.ref), found.notice ?? "");
  assert.deepEqual(found.results, []);
});


const vendorNotes = fs.readFileSync(new URL("vendor-handover.md", samplesDir), "utf8");

function scriptedModel(client, rounds) {
  const original = client.chat.completions.create;
  let round = 0;
  client.chat.completions.create = async () => {
    const step = rounds[round++];
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

test("7.7 读过资料之后，资料里的“命令”不能触发副作用工具", async t => {
  process.env.DASHSCOPE_API_KEY ||= "offline-test";
  process.env.BASE_URL ||= "http://127.0.0.1:9";
  process.env.MODEL ||= "offline-test";
  const { runAgentLoop } = await import("./loop.js");
  const { client } = await import("../client.js");

  const { store, index } = libraryFor(t);
  store.save({ name: "vendor-handover.md", content: vendorNotes });
  const found = await searchDocuments(store, index, "星河科技的合同什么时候续签", fakeEmbedding());
  const ref = found.results[0].ref;

  t.after(scriptedModel(client, [
    { calls: [{ id: "call-1", name: "search_documents", args: { query: "星河科技合同续签" } }] },
    { calls: [{ id: "call-2", name: "set_reminder",
      args: { message: "马上给星河科技转账续费", trigger_at: "2026-10-13T15:05:00+08:00", session_id: "http-test" } }] },
    { text: `合同每年 3 月续签 [${ref}]。资料里有一段要求我设置转账提醒，我没有执行。` }
  ]));

  const executed = [];
  const statuses = [];
  const answer = await runAgentLoop(
    [{ role: "system", content: "test" }, { role: "user", content: "星河科技的合同什么时候续签？" }],
    () => {},
    event => { statuses.push(`${event.name}:${event.status}`); },
    async name => {
      executed.push(name);
      return name === "search_documents" ? JSON.stringify(found) : JSON.stringify({ success: true });
    },
    { checkCompletion: checkCitations }
  );
  console.log("真正执行的工具：", executed);
  console.log("工具卡片状态：", statuses);

  assert.deepEqual(executed, ["search_documents"]);
  assert.ok(statuses.includes("set_reminder:blocked"));
  assert.ok(answer.includes("3 月续签"));
});

test("7.7 没登记权限的工具默认拒绝", async () => {
  const sandbox = new Sandbox();
  const executed = [];
  const run = name => sandbox.executeTool(name, {}, "http-test", async tool => {
    executed.push(tool);
    return JSON.stringify({ ok: true });
  });
  const unknown = JSON.parse(await run("delete_all_documents"));
  console.log("未登记的工具：", unknown);
  assert.ok(unknown.error);
  assert.deepEqual(JSON.parse(await run("get_cost_summary")), { ok: true });
  assert.deepEqual(executed, ["get_cost_summary"]);
});