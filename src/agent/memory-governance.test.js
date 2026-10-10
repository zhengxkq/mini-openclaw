import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "./memory-store.js";
import { selectMemories, formatMemoryPrompt, replaceSystemContext } from "./memory-input.js";
import { handleMemoryCommand } from "./memory-command.js";


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
  store.remember({ ...preference, scope: "session:A",
    content: "回答先给操作步骤" });

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