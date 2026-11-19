import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { identityKey, openAIChatUsage, measureCompletion } from "./usage-meter.js";
import { UsageLedger } from "./usage-ledger.js";

const identity = { provider: "fixture", model: "pinecone-fixed", protocol: "openai-chat" };
const adapters = new Map([[identityKey(identity), openAIChatUsage]]);
const usage = { prompt_tokens: 21, completion_tokens: 5 };

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-meter-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ledger = new UsageLedger(path.join(dir, "usage.jsonl"));
  return { ledger, context: { identity, adapters, record: event => ledger.append(event) } };
}

test("11.1 最后一片的供应商用量只记录一次", async t => {
  const { ledger, context } = setup(t);
  const request = { model: identity.model, messages: [{ role: "user", content: "松果" }], stream: true };
  const response = await measureCompletion(async () => (async function* () {
    yield { choices: [{ delta: { content: "小林" } }] };
    yield { choices: [], usage };
  })(), request, context);
  for await (const chunk of response) { /* 正常消费真实计量包装后的流 */ }
  const [event] = ledger.read();
  console.log("字节与Token：", event.requestBytes, event.tokens);
  assert.equal(event.requestBytes, Buffer.byteLength(JSON.stringify(request)));
  assert.equal(event.tokens.inputTokens, 21);
  assert.equal(event.status, "completed");
  assert.equal(ledger.read().length, 1);
});

test("11.1 无用量和不匹配协议分别保留未知", async t => {
  const { ledger, context } = setup(t);
  await measureCompletion(async () => ({ choices: [] }), { model: identity.model }, context);
  await measureCompletion(async () => ({ usage }), { model: identity.model },
    { ...context, identity: { ...identity, protocol: "dashscope-native" } });
  assert.deepEqual(ledger.read().map(event => event.usageSource), ["missing", "unsupported"]);
  assert.equal(ledger.summary().totalTokens, null);
  assert.equal(ledger.summary().unknownUsageCalls, 2);
});

test("11.1 断流和提前停止不是零费用成功", async t => {
  const { ledger, context } = setup(t);
  const broken = await measureCompletion(async () => (async function* () {
    yield { choices: [{ delta: { content: "正在查" } }] };
    throw new Error("合成断流");
  })(), { stream: true }, context);
  await assert.rejects(async () => { for await (const chunk of broken) {} }, /合成断流/);
  const stopped = await measureCompletion(async () => (async function* () {
    yield { choices: [{ delta: { content: "第一片" } }] };
    yield { choices: [], usage };
  })(), { stream: true }, context);
  for await (const chunk of stopped) break;
  assert.deepEqual(ledger.read().map(event => event.status), ["failed", "incomplete"]);
  assert.equal(ledger.summary().totalTokens, null);
});

test("11.1 记录可重读，损坏必须报告", t => {
  const { ledger } = setup(t);
  ledger.append({ id: "one", at: new Date().toISOString(), status: "failed",
    usageSource: "missing", tokens: null });
  assert.equal(new UsageLedger(ledger.file).read().length, 1);
  fs.appendFileSync(ledger.file, "{broken\n");
  assert.throws(() => ledger.read(), /记录第 2 行损坏/);
});