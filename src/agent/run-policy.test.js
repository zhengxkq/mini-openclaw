import test from "node:test";
import assert from "node:assert/strict";
import { prepareToolCalls, assertToolResult } from "./run-policy.js";

const definitions = [{ function: {
  name: "calculate",
  parameters: {
    required: ["expression"],
    properties: { expression: { type: "string" } }
  }
} }];

const call = {
  id: "call_1", type: "function",
  function: {
    name: "calculate", arguments: '{"expression":123}'
  }
};

test("数字 expression 被拒绝", () => {
  assert.throws(() => prepareToolCalls([call], definitions), error => {
    console.log("拒绝原因：", error.code, error.message);
    return error.code === "INVALID_TOOL_ARGUMENTS";
  });
});

test("字符串 expression 通过检查", () => {
  const good = structuredClone(call);
  good.function.arguments = '{"expression":"123+456"}';

  const prepared = prepareToolCalls([good], definitions);
  console.log("通过检查的参数：", prepared[0].args);
  assert.equal(prepared[0].args.expression, "123+456");
  assert.equal(prepared[0].toolCall.id, "call_1");
});

test("第二项工具未知：整批不进入执行循环", () => {
  const good = structuredClone(call);
  good.function.arguments = '{"expression":"123+456"}';
  const bad = structuredClone(good);
  bad.id = "call_2";
  bad.function.name = "missing_tool";
  let executions = 0;
  assert.throws(() => {
    const prepared = prepareToolCalls([good, bad], definitions);
    console.log('prepared', prepared);
    for (const item of prepared) executions++;
  }, error => {
    console.log("整批被拒绝：", error.code);
    return error.code === "TOOL_NOT_ALLOWED";
  });
  
  console.log("执行次数：", executions);
  assert.equal(executions, 0);
});

test("空工具列表被拒绝", () => {
  console.log("待检查的请求：", []);
  assert.throws(() => prepareToolCalls([], definitions), error => {
    console.log("空列表拒绝原因：", error.code);
    return error.code === "INVALID_TOOL_CALL";
  });
});

test("空编号被拒绝", () => {
  const missingId = structuredClone(call);
  missingId.id = "";
  console.log("待检查的编号：", missingId.id);
  assert.throws(() => prepareToolCalls([missingId], definitions), error => {
    console.log("编号拒绝原因：", error.code);
    return error.code === "INVALID_TOOL_CALL";
  });
});

test("同一批重复编号被拒绝", () => {
  const good = structuredClone(call);
  good.function.arguments = '{"expression":"123+456"}';
  const duplicate = structuredClone(good);
  console.log("同批编号：", good.id, duplicate.id);

   assert.throws(() => prepareToolCalls([good, duplicate], definitions), error => {
    console.log("重复编号拒绝原因：", error.code);
    return error.code === "INVALID_TOOL_CALL";
  });
});

test("正常工具结果可以写回", () => {
  const result = '{"result":579}';
  console.log("正常结果：", result);
  assert.doesNotThrow(() => assertToolResult(result));
});


test("工具返回 error 时拒绝写回", () => {
  const result = '{"error":"计算失败"}';
  console.log("失败结果：", result);
  assert.throws(() => assertToolResult(result), error => {
    console.log("结果拒绝原因：", error.code);
    return error.code === "TOOL_FAILED";
  });
});

test("对象结果被拒绝", () => {
  const result = { result: 579 };
  console.log("对象结果：", result);
  assert.throws(() => assertToolResult(result), error => {
    console.log("结果类型拒绝原因：", error.code);
    return error.code === "INVALID_TOOL_RESULT";
  });
});