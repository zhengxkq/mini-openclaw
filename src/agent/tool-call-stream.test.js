import test from "node:test";
import assert from "node:assert/strict";
import { ToolCallAccumulator } from "./tool-call-stream.js";

test("同一工具的名称和参数分片会拼成完整请求", () => {
  const collector = new ToolCallAccumulator();
  collector.add([{
    index: 0, id: "call_sum",
    function: { name: "calcu", arguments: '{"expression":"123' }
  }]);
  collector.add([{
    index: 0,
    function: { name: "late", arguments: ' + 456"}' }
  }]);

  const [call] = collector.build();
  assert.equal(call.id, "call_sum");
  assert.equal(call.type, "function");
  assert.equal(call.function.name, "calculate");
  assert.equal(call.function.arguments, '{"expression":"123 + 456"}');
  assert.deepEqual(JSON.parse(call.function.arguments), {
    expression: "123 + 456"
  });
});

test("两个工具的交错分片各归各位，按 index 输出", () => {
  const collector = new ToolCallAccumulator();
  collector.add([{
    index: 1, id: "call_b",
    function: { name: "calculate", arguments: '{"expression":"20' }
  }]);
  collector.add([{
    index: 0, id: "call_a",
    function: { name: "calculate", arguments: '{"expression":"10' }
  }]);
  collector.add([
    { index: 1, function: { arguments: ' + 2"}' } },
    { index: 0, function: { arguments: ' + 1"}' } }
  ]);

  const calls = collector.build();
  assert.deepEqual(calls.map(call => call.id), ["call_a", "call_b"]);
  assert.deepEqual(calls.map(call => JSON.parse(call.function.arguments)), [
    { expression: "10 + 1" },
    { expression: "20 + 2" }
  ]);
});

test("后续片段补来的 id 不会丢失", () => {
  const collector = new ToolCallAccumulator();
  collector.add([{
    index: 0,
    function: { name: "calculate", arguments: '{"expression":"1' }
  }]);
  collector.add([{
    index: 0, id: "call_late",
    function: { arguments: ' + 2"}' }
  }]);

  const [call] = collector.build();
  assert.equal(call.id, "call_late");
  assert.deepEqual(JSON.parse(call.function.arguments), { expression: "1 + 2" });
});

test("新一轮的收集器没有上一轮工具请求", () => {
  const first = new ToolCallAccumulator();
  first.add([{
    index: 0, id: "call_first",
    function: { name: "calculate", arguments: '{"expression":"1 + 1"}' }
  }]);
  const second = new ToolCallAccumulator();
  assert.deepEqual(second.build(), []);
  assert.equal(first.build().length, 1);
});