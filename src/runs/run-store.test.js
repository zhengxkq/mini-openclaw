import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RunStore } from "./run-store.js";
import { RunRegistry } from "./run-registry.js";

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "my-openclaw-run-store-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const noModel = async () => { throw new Error("本组测试不请求模型"); };

test("10.3 状态变化和工具调用留档，逐字草稿不留档", t => {
  const store = new RunStore(tempDir(t));
  const runs = new RunRegistry({ store, create: noModel });
  const run = runs.start({ sessionId: "http-a", request: "分别查 INC-204 和 INC-2047", mode: "multi" });

  const draft = runs.record(run, { type: "run_event", event: { taskId: "t1", draft: "INC-204 的负责人是" } });
  const fact = runs.record(run, { type: "run_event", event: { taskId: "t1", status: "running" } });
  const tool = runs.record(run, { type: "tool_call", id: "c1", name: "search_documents", status: "done" });
  const end = runs.finish(run, { status: "succeeded", answer: "两项都已接受。" });

  const lines = store.read(run.runId);
  console.table(lines.map(({ seq, type, status }) => ({ seq, type, status })));
  assert.equal(draft.seq, undefined);
  assert.equal(draft.event.runId, run.runId);
  assert.deepEqual([fact.seq, tool.seq, end.seq], [2, 3, 4]);
  assert.deepEqual(lines.map(line => line.type), ["run_started", "run_event", "tool_call", "run_finished"]);
  assert.equal(lines.at(-1).usage.used, 0);
  assert.equal(runs.finish(run, { status: "failed" }), null);
});

test("10.3 写到一半断电，坏掉的最后一行被忽略，编号接着往下排", t => {
  const dir = tempDir(t);
  const runs = new RunRegistry({ store: new RunStore(dir), create: noModel });
  const run = runs.start({ sessionId: "http-a", request: "计算", mode: "single" });
  runs.record(run, { type: "tool_call", id: "c1", name: "calculate", status: "running" });
  run.dispose();
  fs.appendFileSync(path.join(dir, `${run.runId}.jsonl`), '{"type":"tool_call","id":"c1","sta');

  const reopened = new RunStore(dir);
  console.log("重新打开后读到：", reopened.read(run.runId).map(line => line.seq));
  assert.deepEqual(reopened.read(run.runId).map(line => line.seq), [1, 2]);
  const next = reopened.append(run.runId, { type: "run_finished", runId: run.runId, status: "failed" });
  assert.equal(next.seq, 3);
});

test("10.3 重启时把没写结束记录的运行标记为中断，只标一次", t => {
  const dir = tempDir(t);
  const before = new RunRegistry({ store: new RunStore(dir), create: noModel });
  const unfinished = before.start({ sessionId: "http-a", request: "分别查两项", mode: "multi" });
  unfinished.dispose();
  const done = before.start({ sessionId: "http-b", request: "计算", mode: "single" });
  before.finish(done, { status: "succeeded", answer: "2" });

  const after = new RunRegistry({ store: new RunStore(dir), create: noModel });
  assert.equal(after.closeInterrupted(), 1);
  assert.equal(after.closeInterrupted(), 0);

  const replay = after.recordsFor("http-a");
  console.table(replay.map(({ seq, type, status, code }) => ({ seq, type, status, code })));
  assert.deepEqual(replay.map(line => line.type), ["run_started", "run_finished"]);
  assert.equal(replay.at(-1).status, "interrupted");
  assert.ok(after.recordsFor("http-b").every(line => line.runId === done.runId));
});