import test from "node:test";
import assert from "node:assert/strict";
import { RunController } from "./run-controller.js";

test("模型请求用完以后，第 2 次申请不能进入 sampling", async () => {
  const events = [];
  const run = new RunController({ maxRounds: 1, onEvent: e => events.push(e) });
  await run.beginRound();
  await run.move("deciding", "模型返回");
  await run.move("checking", "验收");
  await run.move("ready", "需要补充");
  await assert.rejects(() => run.beginRound(), { code: "ROUND_LIMIT" });
  assert.equal(events.filter(e => e.phase === "sampling").length, 1);
  assert.equal(run.round, 1);
});

test("不能跳过请求和决策，直接从 ready 执行工具", async () => {
  const run = new RunController();
  await assert.rejects(() => run.move("executing", "跳步"), { code: "INVALID_RUN_TRANSITION" });
});

test("默认验收拒绝空回答，补充机会也有上限", async () => {
  const run = new RunController({ maxRepairs: 1 });
  await run.beginRound();
  await run.move("deciding", "stop");
  await run.move("checking", "检查");
  assert.equal((await run.reviewAnswer({ answer: "" })).action, "continue");
  await run.move("ready", "补充一次");
  await run.beginRound();
  await run.move("deciding", "又是 stop");
  await run.move("checking", "再检查");
  await assert.rejects(() => run.reviewAnswer({ answer: "" }), { code: "COMPLETION_LIMIT" });
});

test("已接受回答后不能重新开始；默认不宣称业务目标已验证", async () => {
  const events = [];
  const run = new RunController({ onEvent: e => events.push(e) });
  await run.beginRound();
  await run.move("deciding", "stop");
  await run.move("checking", "检查");
  const verdict = await run.reviewAnswer({ answer: "579" });
  assert.equal(verdict.goalStatus, "not_checked");
  await run.move("responded", verdict.reason);
  await assert.rejects(() => run.beginRound(), { code: "INVALID_RUN_TRANSITION" });
  assert.deepEqual(events.map(e => e.seq), [1, 2, 3, 4]);
  assert.equal(new Set(events.map(e => e.runId)).size, 1);
});