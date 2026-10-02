import test from "node:test";
import assert from "node:assert/strict";
import { collectToolDelta } from "./tool-call-stream.js";

test("编号第二片才到：补上编号，并拼成完整参数", () => {
  const calls = {};
  collectToolDelta(calls, { index: 0, function: {
    name: "calculate", arguments: '{"expression":'
  } });
  console.log("收到第一片：", calls[0]);
  assert.equal(calls[0].id, "");
  assert.throws(() => JSON.parse(calls[0].arguments), SyntaxError);

  collectToolDelta(calls, { index: 0, id: "call_1", function: {
    arguments: '"123+456"}'
  } });
  console.log("收到第二片：", calls[0]);

  assert.deepEqual(calls[0], {
    id: "call_1", name: "calculate", arguments: '{"expression":"123+456"}'
  });
  assert.equal(JSON.parse(calls[0].arguments).expression, "123+456");
});