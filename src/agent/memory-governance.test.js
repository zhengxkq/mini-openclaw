import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "./memory-store.js";
import { selectMemories, formatMemoryPrompt, replaceSystemContext } from "./memory-input.js";
import { handleMemoryCommand } from "./memory-command.js";
import { recallEpisodes, prepareMemoryContext } from "./episode-recall.js";
import { cosineSimilarity } from "./vector-math.js";
import { readEmbeddingResponse } from "../embedding-client.js";
import { AgentRunError } from "./run-policy.js";
import { EpisodeIndex } from "./episode-index.js";


function storeFor(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "my-openclaw-records-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return new MemoryStore(path.join(dir, "memories.json"));
}

const preference = {
    scope: "agent:default", key: "response_style", kind: "preference",
    sourceId: "manual:response_style", content: "回答先给结论"
};

test("新存储明确使用测试自己的文件", t => {
    const store = storeFor(t);
    console.log("测试存储路径：", store.filePath);
    assert.equal(path.basename(store.filePath), "memories.json");
    assert.equal(fs.existsSync(store.filePath), false);
});


test("还没有文件时查看得到空列表", t => {
    const store = storeFor(t);
    const records = store.list(preference.scope);
    console.log("新目录的记录：", records);
    assert.deepEqual(records, []);
    assert.equal(fs.existsSync(store.filePath), false);
});

test("文件不是列表时停止读取并保留原文件", t => {
    const store = storeFor(t);
    fs.writeFileSync(store.filePath, "{}", "utf8");
    console.log("模拟坏文件：", fs.readFileSync(store.filePath, "utf8"));
    assert.throws(() => store.list(preference.scope), { code: "MEMORY_STORE_INVALID" });
    assert.equal(fs.readFileSync(store.filePath, "utf8"), "{}");
});

test("文件中的版本不合法时停止读取", t => {
    const store = storeFor(t);
    const invalid = { ...preference, id: "fixture-id", version: 0, status: "active" };
    fs.writeFileSync(store.filePath, JSON.stringify([invalid]), "utf8");
    console.log("模拟坏记录：", invalid);

    assert.throws(() => store.list(preference.scope), { code: "MEMORY_STORE_INVALID" });
    assert.equal(JSON.parse(fs.readFileSync(store.filePath, "utf8"))[0].version, 0);
});

test("文件里同一范围和主题重复时停止读取", t => {
    const store = storeFor(t);
    const row = { ...preference, id: "fixture-first", version: 1, status: "active" };
    const rows = [row, { ...row, id: "fixture-second" }];
    fs.writeFileSync(store.filePath, JSON.stringify(rows), "utf8");
    console.log("模拟重复主题：", rows.map(item => [item.id, item.scope, item.key]));

    assert.throws(() => store.list(preference.scope), { code: "MEMORY_STORE_INVALID" });
    assert.equal(JSON.parse(fs.readFileSync(store.filePath, "utf8")).length, 2);

});

test("保存响应风格后能按范围查看", t => {
    const store = storeFor(t);
    console.log("保存输入：", preference);
    const record = store.remember(preference);
    console.log("保存结果：", record);
    assert.equal(record.content, "回答先给结论");
    assert.equal(record.version, 1);
    assert.equal(record.status, "active");
    assert.equal(record.sourceId, preference.sourceId);
    assert.deepEqual(store.list(preference.scope), [record]);
});


test("空内容被拒绝且不创建记忆文件", t => {
    const store = storeFor(t);
    const input = { ...preference, content: " " };
    console.log("空内容输入：", input);
    assert.throws(() => store.remember(input), { code: "INVALID_MEMORY" });
    assert.equal(fs.existsSync(store.filePath), false);
});

test("未知记忆种类被拒绝", t => {
    const store = storeFor(t);
    const input = { ...preference, kind: "unknown" };
    console.log("种类输入：", input);
    assert.throws(() => store.remember(input), { code: "INVALID_MEMORY" });
    assert.equal(fs.existsSync(store.filePath), false);
});


test("相同来源与内容的重复保存不新增记录", t => {
    const store = storeFor(t);
    console.log("两次保存同一输入：", preference);
    const first = store.remember(preference);
    const repeated = store.remember(preference);
    console.log("两次结果：", first, repeated);

    assert.equal(repeated.id, first.id);
    assert.equal(repeated.version, 1);
    assert.deepEqual(repeated, first);
    assert.equal(store.list(preference.scope).length, 1);
});

test("同一主题的新内容要求明确更新", t => {
    const store = storeFor(t);
    const first = store.remember(preference);
    const input = { ...preference, content: "回答先给操作步骤" };
    console.log("已有记录与新输入：", first, input);

    assert.throws(() => store.remember(input), { code: "MEMORY_EXISTS" });
    assert.deepEqual(store.list(preference.scope), [first]);
});


test("重新创建存储对象仍能读到保存结果", t => {
    const store = storeFor(t);
    const record = store.remember(preference);
    const reopened = new MemoryStore(store.filePath);
    console.log("重新读取：", reopened.list(preference.scope));
    assert.deepEqual(reopened.list(preference.scope), [record]);
});

test("两个数据目录彼此隔离", t => {
    const first = storeFor(t), second = storeFor(t);
    first.remember(preference);
    console.log("两个目录的列表：", first.list(preference.scope), second.list(preference.scope));
    assert.notEqual(first.filePath, second.filePath);
    assert.equal(first.list(preference.scope).length, 1);
    assert.deepEqual(second.list(preference.scope), []);
});

test("已有坏文件时保存停止且不覆盖原文", t => {
    const store = storeFor(t);
    fs.writeFileSync(store.filePath, "这不是 JSON", "utf8");
    console.log("保存输入与坏文件：", preference, fs.readFileSync(store.filePath, "utf8"));
    assert.throws(() => store.remember(preference), { code: "MEMORY_STORE_INVALID" });
    assert.equal(fs.readFileSync(store.filePath, "utf8"), "这不是 JSON");
});


test("按当前版本更新响应风格", t => {
    const store = storeFor(t);
    const first = store.remember(preference);
    const content = "回答先给操作步骤";
    console.log("更新输入：", { id: first.id, version: first.version, scope: first.scope, content });
    const updated = store.update(first.id, content, first.version, first.scope);
    console.log("更新结果：", updated);

    assert.equal(updated.id, first.id);
    assert.equal(updated.version, 2);
    assert.equal(updated.content, content);
    assert.equal(updated.sourceId, first.sourceId);
    assert.deepEqual(store.list(first.scope), [updated]);
});

test("旧版本更新被拒绝且不覆盖新结果", t => {
    const store = storeFor(t);
    const first = store.remember(preference);
    const updated = store.update(first.id, "回答先给操作步骤", first.version, first.scope);
    const stale = { id: first.id, version: first.version, scope: first.scope, content: "回答先给结论" };
    console.log("当前记录与旧版本输入：", updated, stale);

    assert.throws(() => store.update(stale.id, stale.content, stale.version, stale.scope), { code: "MEMORY_VERSION_CONFLICT" });
    assert.deepEqual(store.list(first.scope), [updated]);
});

test("空内容更新被拒绝且版本不增加", t => {
    const store = storeFor(t);
    const first = store.remember(preference);
    console.log("空内容更新输入：", { id: first.id, version: first.version, content: " " });
    assert.throws(() => store.update(first.id, " ", first.version, first.scope), { code: "INVALID_MEMORY" });
    assert.deepEqual(store.list(first.scope), [first]);
});

test("删除后退出普通列表并保留删除状态", t => {
    const store = storeFor(t);
    const first = store.remember(preference);
    console.log("删除输入：", { id: first.id, version: first.version, scope: first.scope });
    const deleted = store.remove(first.id, first.version, first.scope);
    console.log("删除结果与检查列表：", deleted, store.list(first.scope, true));

    assert.equal(deleted.id, first.id);
    assert.equal(deleted.version, 2);
    assert.equal(deleted.status, "deleted");
    assert.deepEqual(store.list(first.scope), []);
    assert.deepEqual(store.list(first.scope, true), [deleted]);
});


test("重新读取文件后删除状态仍保留", t => {
    const store = storeFor(t);
    const first = store.remember(preference);
    const deleted = store.remove(first.id, first.version, first.scope);
    const reopened = new MemoryStore(store.filePath);
    console.log("重新读取的普通与检查列表：", reopened.list(first.scope), reopened.list(first.scope, true));

    assert.deepEqual(reopened.list(first.scope), []);
    assert.deepEqual(reopened.list(first.scope, true), [deleted]);
});

test("删除后重放旧保存输入不能复活", t => {
    const store = storeFor(t);
    const first = store.remember(preference);
    const deleted = store.remove(first.id, first.version, first.scope);
    console.log("删除状态与旧保存输入：", deleted, preference);

    assert.throws(() => store.remember(preference), { code: "MEMORY_DELETED" });
    assert.deepEqual(store.list(first.scope), []);
    assert.deepEqual(store.list(first.scope, true), [deleted]);
});

test("另一个范围不能删除这条记录", t => {
    const store = storeFor(t);
    const first = store.remember(preference);
    const scope = "session:fixture-other";
    console.log("跨范围删除输入：", { id: first.id, version: first.version, scope });
    assert.throws(() => store.remove(first.id, first.version, scope), { code: "MEMORY_NOT_FOUND" });
    assert.deepEqual(store.list(first.scope), [first]);
});

test("明确恢复删除记录并增加版本", t => {
    const store = storeFor(t);
    const first = store.remember(preference);
    const deleted = store.remove(first.id, first.version, first.scope);
    console.log("恢复输入：", { id: deleted.id, version: deleted.version, scope: deleted.scope });
    const restored = store.restore(deleted.id, deleted.version, deleted.scope);
    console.log("恢复结果：", restored);

    assert.equal(restored.id, first.id);
    assert.equal(restored.version, 3);
    assert.equal(restored.status, "active");
    assert.equal(restored.content, first.content);
    assert.deepEqual(store.list(first.scope), [restored]);
});

test("旧版本不能恢复删除记录", t => {
    const store = storeFor(t);
    const first = store.remember(preference);
    const deleted = store.remove(first.id, first.version, first.scope);
    console.log("旧版本恢复输入：", { id: first.id, version: first.version, scope: first.scope });
    assert.throws(() => store.restore(first.id, first.version, first.scope), { code: "MEMORY_VERSION_CONFLICT" });
    assert.deepEqual(store.list(first.scope, true), [deleted]);
});

test("已删除记录不能通过更新变回有效", t => {
    const store = storeFor(t);
    const first = store.remember(preference);
    const deleted = store.remove(first.id, first.version, first.scope);
    console.log("删除后的更新输入：", { id: deleted.id, version: deleted.version, content: "回答先给操作步骤" });
    assert.throws(() => store.update(deleted.id, "回答先给操作步骤", deleted.version, deleted.scope), { code: "MEMORY_NOT_FOUND" });
    assert.deepEqual(store.list(first.scope, true), [deleted]);
});

test("当前聊天覆盖同名偏好，其他聊天仍用全局值", t => {
    const store = storeFor(t);
    store.remember(preference);
    store.remember({
        ...preference, scope: "session:A",
        content: "回答先给操作步骤"
    });

    const a = selectMemories(store, ["agent:default", "session:A"]);
    const b = selectMemories(store, ["agent:default", "session:B"]);
    console.log("聊天 A：", a.map(row => row.content));
    console.log("聊天 B：", b.map(row => row.content));
    assert.deepEqual(a.map(row => row.content), ["回答先给操作步骤"]);
    assert.deepEqual(b.map(row => row.content), ["回答先给结论"]);
    assert.equal(store.list("agent:default")[0].content, "回答先给结论");

    const local = store.list("session:A")[0];
    store.remove(local.id, local.version, local.scope);
    const after = selectMemories(store, ["agent:default", "session:A"]);
    console.log("删除 A 的覆盖项后：", after.map(row => row.content));
    assert.deepEqual(after.map(row => row.content), ["回答先给结论"]);

});


test("输入只含更新后的值，删除后不再注入", t => {
    const store = storeFor(t);
    const first = store.remember(preference);
    const next = store.update(first.id, "回答先给操作步骤", first.version, first.scope);
    const prompt = formatMemoryPrompt(store, [first.scope]);
    console.log("当前记忆输入：", prompt);
    assert.ok(prompt.includes("回答先给操作步骤"));
    assert.ok(!prompt.includes("回答先给结论"));
    store.remove(next.id, next.version, next.scope);
    assert.equal(formatMemoryPrompt(store, [first.scope]), "");
});

test("每次刷新首条 system，后面的消息保持原样", t => {
    const store = storeFor(t);
    const row = store.remember(preference);
    const messages = [{ role: "system", content: "最初输入" },
    { role: "user", content: "继续计算" }];
    const tail = structuredClone(messages.slice(1));
    replaceSystemContext(messages, formatMemoryPrompt(store, [row.scope]));
    const before = messages[0].content;
    store.update(row.id, "回答先给操作步骤", row.version, row.scope);
    console.log("已更新文件，但未刷新：", messages[0].content);
    assert.equal(messages[0].content, before);
    replaceSystemContext(messages, formatMemoryPrompt(store, [row.scope]));
    console.log("第一次：", before);
    console.log("第二次：", messages[0].content);
    assert.ok(before.includes("回答先给结论"));
    assert.ok(messages[0].content.includes("回答先给操作步骤"));
    assert.deepEqual(messages.slice(1), tail);
});


test("普通聊天返回 null，不创建记忆文件", (t) => {
    const store = storeFor(t);
    const result = handleMemoryCommand("请计算 123+456", { store, sessionId: "http-test" });
    console.log("普通聊天的管理结果：", result);
    assert.equal(result, null);
    assert.equal(fs.existsSync(store.filePath), false);
});

test("坏 JSON 返回错误，记忆文件字节不变", (t) => {
    const store = storeFor(t); store.remember(preference);
    const before = fs.readFileSync(store.filePath, "utf8");
    const result = JSON.parse(handleMemoryCommand('/memory update {"id":', { store }));
    console.log("坏 JSON 的结果：", result);
    assert.equal(result.error, "INVALID_MEMORY_COMMAND");
    assert.equal(fs.readFileSync(store.filePath, "utf8"), before);
});

test("session 作用域使用 Gateway 编号", (t) => {
    const store = storeFor(t), context = { store, sessionId: "http-owned" };
    const args = { scope: "session", sessionId: "http-other", key: "response_style", content: "回答先给结论", kind: "preference" };
    const result = JSON.parse(handleMemoryCommand(`/memory remember ${JSON.stringify(args)}`, context));
    console.log("实际保存的作用域：", result.scope);
    assert.equal(result.scope, "session:http-owned");
    assert.equal(store.list("session:http-other").length, 0);

    const before = fs.readFileSync(store.filePath, "utf8");
    args.scope = "session:http-other";
    const rejected = JSON.parse(handleMemoryCommand(`/memory remember ${JSON.stringify(args)}`, context));
    console.log("自行拼作用域的结果：", rejected.error);
    assert.equal(rejected.error, "INVALID_MEMORY_SCOPE");
    assert.equal(fs.readFileSync(store.filePath, "utf8"), before);


});

test("管理命令拒绝旧版本，并保留新内容", (t) => {
    const store = storeFor(t), context = { store }, first = store.remember(preference);
    const args = { id: first.id, version: first.version, content: "回答先给操作步骤" };
    const current = JSON.parse(handleMemoryCommand(`/memory update ${JSON.stringify(args)}`, context));
    console.log("第一次更新：", current.content, current.version);
    assert.equal(current.content, "回答先给操作步骤");
    assert.equal(current.version, first.version + 1);
    const before = fs.readFileSync(store.filePath, "utf8");
    args.content = "回答先给结论";
    const rejected = JSON.parse(handleMemoryCommand(`/memory update ${JSON.stringify(args)}`, context));
    console.log("拿旧版本再次更新：", rejected.error);
    assert.equal(rejected.error, "MEMORY_VERSION_CONFLICT");
    assert.equal(store.list("agent:default")[0].content, current.content);
    assert.equal(fs.readFileSync(store.filePath, "utf8"), before);
});


const episode = {
    scope: "agent:default", key: "pinecone_deploy", kind: "episode",
    sourceId: "manual:pinecone_deploy",
    content: "松果项目决定先部署到测试环境，确认后再上线。"
};
const deploymentQuery = "松果项目上次决定怎么部署？";
const fixedEmbedding = {
    dimensions: 2, space: "fixture-v1",
    embed: async text => text.includes("松果") ? [1, 0] : [0, 1]
};

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test("第六课观察部署事件是否全量进入输入", async t => {
    const store = storeFor(t);
    store.remember(preference);
    store.remember(episode);
    store.remember({
        ...episode, key: "coffee_trip",
        sourceId: "manual:coffee_trip", content: "周末去了咖啡店，点了一杯拿铁。"
    });
    const before = formatMemoryPrompt(store, [episode.scope]);
    console.log("只直接读取稳定记忆：", before);

    const prepared = await prepareMemoryContext(store, [episode.scope], deploymentQuery, fixedEmbedding);
    console.table(prepared.report.candidates);
    console.log("召回后实际记忆输入：", prepared.content);

    assert.ok(before.includes("回答先给结论"));
    assert.ok(!before.includes("松果"));
    assert.ok(prepared.content.includes(episode.content));
    assert.ok(!prepared.content.includes("拿铁"));
    assert.equal(prepared.report.candidates.find(row => row.key === "pinecone_deploy").score, 1);
    assert.equal(prepared.report.candidates.find(row => row.key === "coffee_trip").reason, "below_threshold");
});

test("第六课没有事件时不调用向量服务", async t => {
    const store = storeFor(t);
    let calls = 0;
    const embedding = {
        ...fixedEmbedding, embed: async text => {
            calls++;
            return fixedEmbedding.embed(text);
        }
    };
    const result = await recallEpisodes(store, [episode.scope], deploymentQuery, embedding);
    console.log("空事件结果：", result, "调用次数：", calls);
    assert.deepEqual(result.rows, []);
    assert.equal(result.report.emptyReason, "no_candidates");
    assert.equal(calls, 0);
});

test("第六课观察不同维度不能继续打分", () => {
    console.log("问题向量：", [1, 0], "记录向量：", [1]);
    try {
        console.log("原计算结果：", cosineSimilarity([1, 0], [1]));
    } catch (error) {
        console.log("检查错误：", error.code);
    }
    assert.throws(() => cosineSimilarity([1, 0], [1]), { code: "INVALID_VECTOR" });
    assert.throws(() => cosineSimilarity([0, 0], [1, 0]), { code: "INVALID_VECTOR" });
    assert.throws(() => cosineSimilarity([NaN, 0], [1, 0]), { code: "INVALID_VECTOR" });
    const sparse = new Array(2);
    sparse[0] = 1;
    assert.throws(() => cosineSimilarity(sparse, [1, 0]), { code: "INVALID_VECTOR" });
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
});

test("第六课供应商响应按编号配对，不接受重复编号", () => {
    const response = {
        data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] }
        ]
    };
    const vectors = readEmbeddingResponse(response, 2, 2);
    console.log("按输入编号重排：", vectors);
    assert.deepEqual(vectors, [[1, 0], [0, 1]]);
    const duplicate = { data: [response.data[0], response.data[0]] };
    console.log("重复编号：", duplicate.data.map(item => item.index));
    assert.throws(() => readEmbeddingResponse(duplicate, 2, 2), { code: "EMBEDDING_RESPONSE_INVALID" });
    assert.throws(() => readEmbeddingResponse({ data: [] }, 1, 2), { code: "EMBEDDING_RESPONSE_INVALID" });
    assert.throws(() => readEmbeddingResponse({ data: [{ index: 0, embedding: [1] }] }, 1, 2),
        { code: "INVALID_VECTOR" });
});

test("第六课向量错误时保留偏好但不注入事件", async t => {
    const store = storeFor(t);
    store.remember(preference);
    store.remember(episode);
    const wrong = { ...fixedEmbedding, embed: async () => [1] };
    const prepared = await prepareMemoryContext(store, [episode.scope], deploymentQuery, wrong);
    console.log("降级报告：", prepared.report, "实际输入：", prepared.content);
    assert.equal(prepared.report.error, "INVALID_VECTOR");
    assert.equal(prepared.report.emptyReason, "recall_failed");
    assert.ok(prepared.content.includes(preference.content));
    assert.ok(!prepared.content.includes(episode.content));
    assert.equal(store.list(episode.scope).length, 2);
});

test("第六课服务失败与源记忆损坏走不同分支", async t => {
    const store = storeFor(t);
    store.remember(episode);
    const unavailable = {
        ...fixedEmbedding, embed: async () => {
            throw new AgentRunError("EMBEDDING_UNAVAILABLE", "固定服务失败");
        }
    };
    const prepared = await prepareMemoryContext(store, [episode.scope], deploymentQuery, unavailable);
    console.log("服务失败：", prepared.report);
    assert.equal(prepared.report.error, "EMBEDDING_UNAVAILABLE");
    assert.equal(prepared.content, "");
    fs.writeFileSync(store.filePath, "{}", "utf8");
    await assert.rejects(() => prepareMemoryContext(store, [episode.scope], deploymentQuery, unavailable),
        { code: "MEMORY_STORE_INVALID" });
    assert.equal(fs.readFileSync(store.filePath, "utf8"), "{}");
});

test("第六课阈值通过后还要受topK限制", async t => {
    const store = storeFor(t);
    const main = store.remember(episode);
    const backup = store.remember({
        ...episode, key: "pinecone_backup",
        sourceId: "manual:pinecone_backup", content: "松果项目上线前要确认备份。"
    });
    const embedding = {
        ...fixedEmbedding, embed: async text => {
            if (text === backup.content) return [0.8, 0.6];
            return fixedEmbedding.embed(text);
        }
    };
    const one = await recallEpisodes(store, [episode.scope], deploymentQuery, embedding,
        { threshold: 0.8, topK: 1 });
    const more = await recallEpisodes(store, [episode.scope], deploymentQuery, embedding,
        { threshold: 0.8, topK: 3 });
    console.log("topK=1：");
    console.table(one.report.candidates);
    console.log("topK=3：");
    console.table(more.report.candidates);
    assert.deepEqual(one.rows.map(row => row.id), [main.id]);
    assert.equal(one.report.candidates.find(row => row.id === backup.id).reason, "top_k");
    assert.deepEqual(more.rows.map(row => row.id), [main.id, backup.id]);
    assert.equal(more.report.candidates.find(row => row.id === backup.id).reason, "selected");
});

test("第六课低分候选得到正常空结果", async t => {
    const store = storeFor(t);
    store.remember(episode);
    const result = await recallEpisodes(store, [episode.scope], "今天天气怎样？", fixedEmbedding);
    console.table(result.report.candidates);
    console.log("空结果原因：", result.report.emptyReason);
    assert.deepEqual(result.rows, []);
    assert.equal(result.report.candidates[0].score, 0);
    assert.equal(result.report.candidates[0].reason, "below_threshold");
    assert.equal(result.report.emptyReason, "no_selected");
    assert.equal(result.report.error, undefined);
});

test("同一事件重复召回：记录向量可以复用", async t => {
    const store = storeFor(t);
    const row = store.remember(episode);
    const index = new EpisodeIndex(path.join(path.dirname(store.filePath), "episode-index.json"));
    const calls = [];
    const embedding = {
        ...fixedEmbedding,
        embed: async text => {
            calls.push(text);
            return fixedEmbedding.embed(text);
        }
    };
    const first = await recallEpisodes(store, [row.scope], deploymentQuery, embedding, { index });
    const second = await recallEpisodes(store, [row.scope], deploymentQuery, embedding, { index });
    console.log("两次召回的记录：", first.rows.map(item => item.id), second.rows.map(item => item.id));
    console.log("查询生成次数：", calls.filter(text => text === deploymentQuery).length);
    console.log("事件生成次数：", calls.filter(text => text === row.content).length);

    assert.equal(calls.filter(text => text === deploymentQuery).length, 2);
    assert.equal(calls.filter(text => text === row.content).length, 1);
    assert.deepEqual(first.rows.map(item => item.id), [row.id]);
    assert.deepEqual(second.rows.map(item => item.id), [row.id]);
    const saved = JSON.parse(fs.readFileSync(index.filePath, "utf8"));
    console.log("磁盘索引条目：", saved.entries.map(item => ({ id: item.id, version: item.version })));
    assert.equal(saved.schema, 1);
    assert.equal(saved.entries.length, 1);
    assert.equal(saved.entries[0].version, row.version);
});

test("重开索引仍复用磁盘里的记录向量", async t => {
    const store = storeFor(t), row = store.remember(episode);
    const index = new EpisodeIndex(path.join(path.dirname(store.filePath), "episode-index.json"));
    const calls = [];
    const embedding = {
        ...fixedEmbedding,
        embed: async text => { calls.push(text); return fixedEmbedding.embed(text); }
    };
    await recallEpisodes(store, [row.scope], deploymentQuery, embedding, { index });
    const reopened = new EpisodeIndex(index.filePath);
    const result = await recallEpisodes(store, [row.scope], deploymentQuery, embedding, { index: reopened });
    console.log("重开后选中：", result.rows.map(item => item.id));
    console.log("累计查询/事件生成：",
        calls.filter(text => text === deploymentQuery).length,
        calls.filter(text => text === row.content).length);
    assert.deepEqual(result.rows.map(item => item.id), [row.id]);
    assert.equal(calls.filter(text => text === deploymentQuery).length, 2);
    assert.equal(calls.filter(text => text === row.content).length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(reopened.filePath, "utf8")).entries[0].vector, [1, 0]);
});

test("更新事件后索引只保留新版本", async t => {
    const store = storeFor(t), row = store.remember(episode);
    const index = new EpisodeIndex(path.join(path.dirname(store.filePath), "episode-index.json"));
    const calls = [];
    const embedding = {
        ...fixedEmbedding,
        embed: async text => { calls.push(text); return fixedEmbedding.embed(text); }
    };
    await recallEpisodes(store, [row.scope], deploymentQuery, embedding, { index });
    const updated = store.update(row.id, "松果项目决定直接部署到正式环境。", row.version, row.scope);
    console.log("更新后、召回前的索引版本：", JSON.parse(fs.readFileSync(index.filePath, "utf8")).entries[0].version);
    const result = await recallEpisodes(store, [row.scope], deploymentQuery, embedding, { index });
    const saved = JSON.parse(fs.readFileSync(index.filePath, "utf8"));
    console.log("召回后版本与文字：", result.rows.map(item => [item.version, item.content]));
    console.log("索引版本：", saved.entries.map(item => item.version));

    assert.deepEqual(result.rows.map(item => item.id), [row.id]);
    assert.equal(result.rows[0].content, updated.content);
    assert.equal(result.rows[0].version, updated.version);
    assert.equal(saved.entries.length, 1);
    assert.equal(saved.entries[0].version, updated.version);
    assert.equal(saved.entries[0].content, updated.content);
    assert.equal(calls.filter(text => text === row.content).length, 1);
    assert.equal(calls.filter(text => text === updated.content).length, 1);
});

test("删除最后事件后零候选且索引清空", async t => {
    const store = storeFor(t), row = store.remember(episode);
    const index = new EpisodeIndex(path.join(path.dirname(store.filePath), "episode-index.json"));
    const calls = [];
    const embedding = {
        ...fixedEmbedding,
        embed: async text => { calls.push(text); return fixedEmbedding.embed(text); }
    };
    await recallEpisodes(store, [row.scope], deploymentQuery, embedding, { index });
    const deleted = store.remove(row.id, row.version, row.scope);
    const callsBefore = calls.length;
    console.log("删除后、召回前的索引数量：", JSON.parse(fs.readFileSync(index.filePath, "utf8")).entries.length);
    const result = await recallEpisodes(store, [row.scope], deploymentQuery, embedding, { index });
    const saved = JSON.parse(fs.readFileSync(index.filePath, "utf8"));
    console.log("删除后的召回：", result.rows, result.report.emptyReason);
    console.log("删除后的索引：", saved.entries);

    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.report.candidates, []);
    assert.equal(result.report.emptyReason, "no_candidates");
    assert.deepEqual(saved.entries, []);
    assert.equal(calls.length, callsBefore);
    assert.deepEqual(store.list(row.scope, true), [deleted]);
});

test("明确恢复后用新版本重新生成事件向量", async t => {
    const store = storeFor(t), row = store.remember(episode);
    const index = new EpisodeIndex(path.join(path.dirname(store.filePath), "episode-index.json"));
    const calls = [];
    const embedding = {
        ...fixedEmbedding,
        embed: async text => { calls.push(text); return fixedEmbedding.embed(text); }
    };
    await recallEpisodes(store, [row.scope], deploymentQuery, embedding, { index });
    const deleted = store.remove(row.id, row.version, row.scope);
    const restored = store.restore(deleted.id, deleted.version, deleted.scope);
    const before = JSON.parse(fs.readFileSync(index.filePath, "utf8"));
    console.log("恢复后、召回前：索引版本/记忆版本：", before.entries[0].version, restored.version);
    const result = await recallEpisodes(store, [row.scope], deploymentQuery, embedding, { index });
    const saved = JSON.parse(fs.readFileSync(index.filePath, "utf8"));
    console.log("恢复后的选中版本：", result.rows.map(item => item.version));
    console.log("事件生成次数与索引版本：",
        calls.filter(text => text === row.content).length,
        saved.entries.map(item => item.version));

    assert.equal(before.entries[0].version, row.version);
    assert.equal(restored.version, deleted.version + 1);
    assert.equal(restored.status, "active");
    assert.deepEqual(result.rows.map(item => [item.id, item.version]), [[row.id, restored.version]]);
    assert.equal(result.report.candidates[0].version, restored.version);
    assert.equal(calls.filter(text => text === row.content).length, 2);
    assert.equal(saved.entries.length, 1);
    assert.equal(saved.entries[0].version, restored.version);
    assert.equal(saved.entries[0].content, restored.content);
});

test("召回 A 不删除 B 的有效索引", async t => {
    const store = storeFor(t);
    const a = store.remember({ ...episode, scope: "session:A" });
    const b = store.remember({ ...episode, scope: "session:B" });
    const index = new EpisodeIndex(path.join(path.dirname(store.filePath), "episode-index.json"));
    await recallEpisodes(store, [a.scope], deploymentQuery, fixedEmbedding, { index });
    await recallEpisodes(store, [b.scope], deploymentQuery, fixedEmbedding, { index });
    const result = await recallEpisodes(store, [a.scope], deploymentQuery, fixedEmbedding, { index });
    const saved = JSON.parse(fs.readFileSync(index.filePath, "utf8"));
    console.log("A 的召回 ID：", result.rows.map(item => item.id));
    console.log("文件保留的范围：", saved.entries.map(item => item.scope));

    assert.deepEqual(result.rows.map(item => item.id), [a.id]);
    assert.deepEqual(new Set(saved.entries.map(item => item.id)), new Set([a.id, b.id]));
});

test("向量空间变化后重新生成记录向量", async t => {
    const store = storeFor(t), row = store.remember(episode);
    const index = new EpisodeIndex(path.join(path.dirname(store.filePath), "episode-index.json"));
    const calls = [];
    const embedding = {
        ...fixedEmbedding,
        embed: async text => { calls.push(text); return fixedEmbedding.embed(text); }
    };
    await recallEpisodes(store, [row.scope], deploymentQuery, embedding, { index });
    const changed = { ...embedding, space: "fixture-v2" };
    const result = await recallEpisodes(store, [row.scope], deploymentQuery, changed, { index });
    const saved = JSON.parse(fs.readFileSync(index.filePath, "utf8"));
    console.log("空间改变后的事件生成次数：", calls.filter(text => text === row.content).length);
    console.log("现在的索引空间：", saved.entries.map(item => item.space));

    assert.equal(calls.filter(text => text === row.content).length, 2);
    assert.equal(saved.entries.length, 1);
    assert.equal(saved.entries[0].space, "fixture-v2");
    assert.equal(saved.entries[0].version, row.version);
    assert.deepEqual(result.rows.map(item => item.id), [row.id]);
    assert.equal(store.list(row.scope)[0].version, row.version);
});


test("坏索引拒绝读取，原文件字节不变", async t => {
    const store = storeFor(t), row = store.remember(episode);
    const index = new EpisodeIndex(path.join(path.dirname(store.filePath), "episode-index.json"));
    const broken = {
        schema: 1, entries: [{
            id: row.id, scope: row.scope, key: row.key, version: row.version,
            content: row.content, space: fixedEmbedding.space, dimensions: 2, vector: [1]
        }]
    };
    fs.writeFileSync(index.filePath, JSON.stringify(broken), "utf8");
    const before = fs.readFileSync(index.filePath, "utf8");
    let calls = 0;
    const embedding = {
        ...fixedEmbedding,
        embed: async text => { calls++; return fixedEmbedding.embed(text); }
    };
    const error = await recallEpisodes(store, [row.scope], deploymentQuery, embedding, { index })
        .then(() => null, caught => caught);
    console.log("读取坏索引的错误：", error?.code, "生成次数：", calls);

    assert.equal(error?.code, "EPISODE_INDEX_INVALID");
    assert.equal(calls, 0);
    assert.equal(fs.readFileSync(index.filePath, "utf8"), before);
    assert.deepEqual(store.list(row.scope), [row]);
});

test("召回等待期间更新记录，旧版本不进入输入", { timeout: 5000 }, async t => {
  const store = storeFor(t);
  const savedPreference = store.remember(preference);
  const first = store.remember(episode);
  const fallback = store.remember({
    ...episode,
    key: "pinecone_release_check",
    sourceId: "manual:pinecone_release_check",
    content: "松果项目还有一项决定：发布前先运行自动检查。"
  });
  const index = new EpisodeIndex(path.join(path.dirname(store.filePath), "episode-index.json"));
  const entered = deferred();
  const continueEmbedding = deferred();
  const pausedEmbedding = {
    ...fixedEmbedding,
    embed: async text => {
      if (text === first.content) {
        entered.resolve();
        await continueEmbedding.promise;
      }
      if (text === fallback.content) return [0.8, 0.6];
      return fixedEmbedding.embed(text);
    }
  };
  const pending = prepareMemoryContext(store, [first.scope],
    "松果项目上次决定怎么部署？", pausedEmbedding,
    { index, threshold: 0.6, topK: 1 });
  await entered.promise;
  console.log("已停在旧事件的向量请求：", { id: first.id, version: first.version });
  const next = store.update(first.id,
    "松果项目改为先补文档，暂不部署。", first.version, first.scope);
  const nextPreference = store.update(savedPreference.id,
    "回答先给操作步骤", savedPreference.version, savedPreference.scope);
  console.log("等待期间的当前值：", {
    episode: { version: next.version, content: next.content },
    preference: { version: nextPreference.version, content: nextPreference.content }
  });
  continueEmbedding.resolve();
  const result = await pending;
  console.table(result.report.candidates);
  console.log("等待结束后的模型记忆片段：", result.content);
    const oldDecision = result.report.candidates.find(item => item.id === first.id);
  const validDecision = result.report.candidates.find(item => item.id === fallback.id);
  assert.equal(oldDecision.reason, "stale");
  assert.equal(oldDecision.version, first.version);
  assert.equal(validDecision.reason, "selected");
  assert.ok(!result.content.includes(first.content));
  assert.ok(result.content.includes(fallback.content));
  assert.ok(result.content.includes(nextPreference.content));
  assert.ok(!result.content.includes(savedPreference.content));
  const afterWait = JSON.parse(fs.readFileSync(index.filePath, "utf8"));
  console.log("本次结束后的派生索引：", afterWait.entries.map(item => [item.key, item.version]));
  assert.ok(!afterWait.entries.some(item => item.id === first.id));

    const following = await prepareMemoryContext(store, [first.scope],
    "松果项目上次决定怎么部署？", pausedEmbedding,
    { index, threshold: 0.6, topK: 1 });
  console.table(following.report.candidates);
  console.log("下一次召回的模型记忆片段：", following.content);
  assert.ok(following.content.includes(next.content));
  assert.ok(!following.content.includes(first.content));
  assert.equal(following.report.candidates.find(item => item.id === first.id).version,
    next.version);
  const refreshed = JSON.parse(fs.readFileSync(index.filePath, "utf8"));
  assert.ok(refreshed.entries.some(item => item.id === next.id
    && item.version === next.version && item.content === next.content));
});


test("召回等待期间删除记录，旧候选不进入输入", { timeout: 5000 }, async t => {
  const store = storeFor(t);
  const stable = store.remember(preference);
  const first = store.remember(episode);
  const index = new EpisodeIndex(path.join(path.dirname(store.filePath), "episode-index.json"));
  const entered = deferred();
  const continueEmbedding = deferred();
  const pausedEmbedding = {
    ...fixedEmbedding,
    embed: async text => {
      if (text === first.content) {
        entered.resolve();
        await continueEmbedding.promise;
      }
      return fixedEmbedding.embed(text);
    }
  };
  const pending = prepareMemoryContext(store, [first.scope],
    "松果项目上次决定怎么部署？", pausedEmbedding, { index });
  await entered.promise;
    const deleted = store.remove(first.id, first.version, first.scope);
  console.log("等待期间删除：", { id: deleted.id, version: deleted.version, status: deleted.status });
  continueEmbedding.resolve();
  const result = await pending;
  console.table(result.report.candidates);
  console.log("最终记忆片段：", result.content);
  console.log("空结果原因：", result.report.emptyReason);
    assert.equal(result.report.candidates.find(item => item.id === first.id).reason, "stale");
  assert.equal(result.report.emptyReason, "no_selected");
  assert.ok(!result.content.includes(first.content));
  assert.ok(result.content.includes(stable.content));
  assert.deepEqual(JSON.parse(fs.readFileSync(index.filePath, "utf8")).entries, []);
  assert.equal(store.list(first.scope, true).find(item => item.id === first.id).status,
    "deleted");
  let embeddingCalls = 0;
  const following = await recallEpisodes(store, [first.scope],
    "松果项目上次决定怎么部署？", {
      ...fixedEmbedding,
      embed: async text => {
        embeddingCalls++;
        return fixedEmbedding.embed(text);
      }
    }, { index });
  console.log("下一次：", following.report.emptyReason, "向量请求次数：", embeddingCalls);
  assert.equal(following.report.emptyReason, "no_candidates");
  assert.equal(embeddingCalls, 0);
});

test("等待期间的 session 同名 preference 覆盖全局 episode", { timeout: 5000 }, async t => {
  const store = storeFor(t);
  const first = store.remember(episode);
  const scopes = [first.scope, "session:A"];
  const index = new EpisodeIndex(path.join(path.dirname(store.filePath), "episode-index.json"));
  const entered = deferred();
  const continueEmbedding = deferred();
  const pausedEmbedding = {
    ...fixedEmbedding,
    embed: async text => {
      if (text === first.content) {
        entered.resolve();
        await continueEmbedding.promise;
      }
      return fixedEmbedding.embed(text);
    }
  };
  const pending = prepareMemoryContext(store, scopes,
    "松果项目上次决定怎么部署？", pausedEmbedding, { index });
  await entered.promise;
    const local = store.remember({
    ...preference,
    scope: "session:A",
    key: first.key,
    sourceId: "manual:pinecone_local_style",
    content: "回答松果项目时先列核对步骤。"
  });
  console.log("等待期间的聊天覆盖项：", {
    key: local.key, kind: local.kind, scope: local.scope, content: local.content
  });
  continueEmbedding.resolve();
  const result = await pending;
  console.table(result.report.candidates);
  console.log("聊天 A 的最终记忆片段：", result.content);
    assert.equal(result.report.candidates.find(item => item.id === first.id).reason, "stale");
  assert.ok(!result.content.includes(first.content));
  assert.ok(result.content.includes(local.content));
  assert.equal(store.list(first.scope)[0].status, "active");
  const entries = JSON.parse(fs.readFileSync(index.filePath, "utf8")).entries;
  assert.ok(entries.some(item => item.id === first.id));
  const other = await prepareMemoryContext(store, [first.scope, "session:B"],
    "松果项目上次决定怎么部署？", fixedEmbedding, { index });
  console.table(other.report.candidates);
  console.log("聊天 B 的最终记忆片段：", other.content);
  assert.equal(other.report.candidates.find(item => item.id === first.id).reason, "selected");
  assert.ok(other.content.includes(first.content));
  assert.ok(!other.content.includes(local.content));
});