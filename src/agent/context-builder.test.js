import test from "node:test";
import assert from "node:assert/strict";
import { buildModelContext, inputBytes } from "./context-builder.js";


const messages = [
  { role: "system", content: "你是助手" },
  { role: "user", content: "第一组" },
  { role: "assistant", content: "一" },
  { role: "user", content: "第二组" },
  { role: "assistant", content: "二" },
  { role: "user", content: "第三组" }
];

test("额度只够当前组时，省略两组旧历史", async () => {
  const minimum = [messages[0], messages.at(-1)];
  const limit = inputBytes(minimum);
  const result = await buildModelContext(messages, { maxInputBytes: limit });
  console.log("选中的内容：", result.messages.map(item => item.content));
  console.log("大小报告：", result.report);

  assert.deepEqual(result.messages, minimum);
  assert.equal(result.report.removedTurns, 2);
  assert.equal(result.report.inputBytes, limit);
});


test("改返回的副本，不会改原记录", async () => {
  const result = await buildModelContext(messages);
  result.messages.at(-1).content = "改过的副本";
  console.log("副本末条：", result.messages.at(-1).content);
  console.log("原记录末条：", messages.at(-1).content);

  assert.equal(result.messages.at(-1).content, "改过的副本");
  assert.equal(messages.at(-1).content, "第三组");
});


test("连当前组都装不下时拒绝请求", async () => {
  const minimum = [messages[0], messages.at(-1)];
  const limit = inputBytes(minimum) - 1;
  console.log("必要输入 / 额度：", inputBytes(minimum), limit);

  await assert.rejects(
    () => buildModelContext(messages, { maxInputBytes: limit }),
    error => {
      console.log("超限原因：", error.code, error.message);
      return error.code === "CONTEXT_LIMIT";
    }
  );
});


test("孤立的工具结果被拒绝", async () => {
  const orphan = [
    { role: "user", content: "计算" },
    { role: "tool", tool_call_id: "不存在", content: "579" }
  ];
  console.log("待检查的历史：", orphan);

  await assert.rejects(() => buildModelContext(orphan), error => {
    console.log("配对拒绝原因：", error.code, error.message);
    return error.code === "INVALID_CONTEXT";
  });
});

test("裁剪旧历史时，当前工具请求和结果一起保留", async () => {
  const toolRound = [
    { role: "user", content: "计算 123+456" },
    { role: "assistant", content: null, tool_calls: [{
      id: "call_1", type: "function",
      function: { name: "calculate", arguments: '{"expression":"123+456"}' }
    }] },
    { role: "tool", tool_call_id: "call_1", content: '{"result":579}' }
  ];

  const required = [messages[0], ...toolRound];
  const toolLimit = inputBytes(required);
  const withTool = await buildModelContext(
    [...messages, ...toolRound], { maxInputBytes: toolLimit }
  );
  console.log("裁剪后角色：", withTool.messages.map(item => item.role));


  assert.deepEqual(withTool.messages, required);
  assert.equal(withTool.report.removedTurns, 3);
  assert.equal(withTool.messages.at(-1).tool_call_id, "call_1");
});


const summaryMessages = structuredClone(messages);
summaryMessages[1].content = "项目名松果。" + "旧讨论。".repeat(100);
summaryMessages[2].content = "收到";
summaryMessages.at(-1).content = "项目名是什么？";


test("摘要只覆盖省略的旧历史，并进入本次输入", async () => {
  const recent = [summaryMessages[0], ...summaryMessages.slice(3)];
  const limit = inputBytes(recent) + 500;
  let summarized = [];
  const result = await buildModelContext(summaryMessages, {
    maxInputBytes: limit,
    summarize: async removed => {
      summarized = removed;
      return "本次项目名为松果。";
    }
  });

  console.log("原记录保留项目名：", summaryMessages[1].content.includes("松果"));
  console.log("本次输入保留项目名：", result.messages.some(item => item.content?.includes("松果")));
  console.log("本次输入内容：", result.messages.map(item => item.content));
  console.log("省略旧组数：", result.report.removedTurns);
  console.log("被摘要的原文条数：", summarized.length);
  console.log("选中的内容：", result.messages.map(item => item.content));
  console.log("摘要采用：", result.report.summaryUsed);

  assert.deepEqual(summarized, summaryMessages.slice(1, 3));
  assert.equal(result.report.summaryUsed, true);
  assert.equal(result.report.removedTurns, 1);
  assert.ok(result.messages[1].content.includes("本次项目名为松果。"));
  assert.deepEqual(result.messages.slice(2), summaryMessages.slice(3));
  assert.ok(result.report.inputBytes <= limit);
});

test("相同旧历史不重复生成摘要", async () => {
  const state = {};
  let summaries = 0;
  const recent = [summaryMessages[0], ...summaryMessages.slice(3)];
  const options = {
    maxInputBytes: inputBytes(recent) + 500,
    state,
    summarize: async () => {
      summaries++;
      return "本次项目名为松果。";
    }
  };

  const first = await buildModelContext(summaryMessages, options);
  console.log("第一次后：", summaries, "采用摘要：", first.report.summaryUsed);
  const second = await buildModelContext(summaryMessages, options);
  console.log("第二次后：", summaries, "采用摘要：", second.report.summaryUsed);

  assert.equal(summaries, 1);
  assert.equal(first.report.summaryUsed, true);
  assert.equal(second.report.summaryUsed, true);
  assert.deepEqual(second.messages, first.messages);

  const changed = structuredClone(summaryMessages);
  changed[1].content += "新增一个决定。";
  const third = await buildModelContext(changed, options);
  console.log("原文变化后：", summaries, "采用摘要：", third.report.summaryUsed);
  assert.equal(summaries, 2);
  assert.equal(third.report.summaryUsed, true);
});
