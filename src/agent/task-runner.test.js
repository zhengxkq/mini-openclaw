import test from "node:test";
import assert from "node:assert/strict";
import { collectTaskResults } from "./task-runner.js";
import { AgentRunError } from "./run-policy.js";

const plan = { tasks: [
  { id: "t1", task: "查 INC-204 的负责人和动作" },
  { id: "t2", task: "查 INC-2047 的负责人和动作" }
] };

test("9.3 第二项失败后继续等第一项，保留成功与失败", async () => {
  let release, failed;
  const gate = new Promise(resolve => { release = resolve; });
  const failureSeen = new Promise(resolve => { failed = resolve; });
  const started = [];
  const events = [];
  let settled = false;
  const pending = collectTaskResults(plan, {
    runTask: async task => {
      started.push(task.id);
      if (task.id === "t2") throw new AgentRunError("TOOL_FAILED", "故障索引请求失败。");
      await gate;
      return "INC-204 由小林负责 [doc-00000001-v1-c0]。";
    },
    onEvent: event => {
      events.push(event);
      if (event.taskId === "t2" && event.status === "failed") failed();
    }
  }).then(result => { settled = true; return result; });

  await failureSeen;
  try {
    console.log("第二项失败时已启动：", started, "整体已返回：", settled);
    assert.deepEqual(started, ["t1", "t2"]);
    assert.equal(settled, false);
  } finally {
    release();
  }
  const outcome = await pending;
  console.table(outcome.results);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => result.status), ["succeeded", "failed"]);
  assert.ok(outcome.answer.includes("已接受 1/2 项；失败 1 项"));
  assert.ok(outcome.answer.includes("[doc-00000001-v1-c0]"));
  assert.ok(outcome.answer.includes("TOOL_FAILED"));
  assert.equal(events.filter(event => event.status === "queued").length, 2);
});

test("9.3 全部接受按计划顺序交付，不再让模型重写出处", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const finishOrder = [];
  const result = await collectTaskResults(plan, {
    runTask: async task => {
      if (task.id === "t1") await gate;
      else release();
      finishOrder.push(task.id);
      return task.id === "t1"
        ? "小林 [doc-00000001-v1-c0]"
        : "小周 [doc-00000001-v1-c1]";
    }
  });
  console.log("返回先后：", finishOrder, "展示先后：", result.results.map(item => item.id));
  assert.deepEqual(finishOrder, ["t2", "t1"]);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.results.map(item => item.id), ["t1", "t2"]);
  assert.ok(result.answer.indexOf("小林") < result.answer.indexOf("小周"));
  assert.ok(result.answer.includes("已接受 2/2 项；失败 0 项"));
});

test("9.3 全失败和空答案都不算成功", async () => {
  const result = await collectTaskResults(plan, {
    runTask: async task => {
      if (task.id === "t1") return " ";
      throw new Error("包含供应商内部细节的原始异常");
    }
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.results.map(item => item.code), ["INVALID_ANSWER", "SUBTASK_FAILED"]);
  assert.ok(!result.answer.includes("供应商内部细节"));
  console.log(result.answer);
});