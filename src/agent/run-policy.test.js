import test from "node:test";
import assert from "node:assert/strict";
import { AgentRunError, prepareToolCalls, assertToolResult } from "./run-policy.js";

const definitions = [{ type: "function", function: {
  name: "calculate",
  parameters: {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"]
  }
} }];
const call = (argumentsText, id = "call_1", name = "calculate") => ({
  id, type: "function", function: { name, arguments: argumentsText }
});
const hasCode = code => error => error instanceof AgentRunError && error.code === code;

test("合法请求保留协议对象，并得到解析后的参数", () => {
  const request = call('{"expression":"123 + 456"}');
  assert.deepEqual(prepareToolCalls([request], definitions), [{
    toolCall: request, args: { expression: "123 + 456" }
  }]);
});

test("未公开工具即使在实现表里存在，也不允许请求", () => {
  assert.throws(() => prepareToolCalls([call("{}", "call_1", "execute_shell")], definitions), hasCode("TOOL_NOT_ALLOWED"));
});

test("空批次、缺 id、重复 id 都被拒绝", () => {
  for (const calls of [[], [call("{}", "")], [call('{"expression":"1"}'), call('{"expression":"2"}')]]) {
    assert.throws(() => prepareToolCalls(calls, definitions), hasCode("INVALID_TOOL_CALL"));
  }
});

test("参数必须是完整 JSON 对象，必填字段与类型须匹配", () => {
  for (const text of ['{"expression":', "null", "[]", "{}", '{"expression":123}']) {
    assert.throws(() => prepareToolCalls([call(text)], definitions), hasCode("INVALID_TOOL_ARGUMENTS"));
  }
});

test("第二个请求非法时，整批校验不能返回可执行列表", () => {
  assert.throws(() => prepareToolCalls([
    call('{"expression":"1 + 1"}', "call_1"),
    call("{}", "call_2", "execute_shell")
  ], definitions), hasCode("TOOL_NOT_ALLOWED"));
});

test("当前工具协议的顶层 error 被识别为失败", () => {
  assert.throws(() => assertToolResult('{"error":"计算失败，请检查表达式"}', "calculate"), hasCode("TOOL_FAILED"));
});

test("正常结果和业务性的 success:false 都不会误判为执行错误", () => {
  assert.doesNotThrow(() => assertToolResult('{"result":579}', "calculate"));
  assert.doesNotThrow(() => assertToolResult('{"success":false,"message":"规则已存在"}', "add_behavior_rule"));
  assert.doesNotThrow(() => assertToolResult("普通文本结果", "example"));
});

test("工具结果必须符合原循环的字符串约定", () => {
  assert.throws(() => assertToolResult(undefined, "calculate"), hasCode("INVALID_TOOL_RESULT"));
});
