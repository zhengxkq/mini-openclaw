import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-product-replay-"));
const changes = {
    DATA_DIR: dir, DASHSCOPE_API_KEY: "offline-test", BASE_URL: "http://127.0.0.1:9",
    MODEL: "pinecone-fixed", METER_MODEL: "pinecone-fixed", METER_PROVIDER: "fixture", METER_PROTOCOL: "openai-chat",
    METER_USAGE_SCHEMA: "openai-chat-usage-v1"
};
const saved = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
Object.assign(process.env, changes);
const { client } = await import("../client.js");
const originalCreate = client.chat.completions.create;
client.chat.completions.create = async () => { throw new Error("固定回放禁止真实模型请求"); };
after(() => {
    client.chat.completions.create = originalCreate;
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
});

const { RunContext } = await import("../runs/run-context.js");
const { RunBudget } = await import("../runs/run-budget.js");
const { ModelGate } = await import("../runs/model-gate.js");
const { runMultiAgent } = await import("../agent/orchestrator.js");
const { runAgentLoop } = await import("../agent/loop.js");
const { Sandbox } = await import("../agent/sandbox.js");
const { DocumentStore } = await import("../agent/document-store.js");
const { DocumentIndex } = await import("../agent/document-index.js");
const { searchDocuments } = await import("../agent/document-search.js");
const { gradeAnswer } = await import("../agent/document-evaluation.js");
const { inputBytes } = await import("../agent/context-builder.js");
const { usageLedger } = await import("./meter-runtime.js");
const incidents = fs.readFileSync(new URL("../../samples/documents/pinecone-incidents.md", import.meta.url), "utf8");
const fixtureUsage = {
    prompt_tokens: 21, completion_tokens: 5,
    prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 }
};

function scripted(steps) {
    let cursor = 0;
    return async (request, sdkOptions) => {
        assert.equal(sdkOptions.maxRetries, 0);
        assert.ok(sdkOptions.signal instanceof AbortSignal);
        const step = steps[cursor++];
        if (!step) throw new Error("剧本没有下一步，产品发生了未声明的调用");
        step.inspect?.(request);
        const text = typeof step.text === "function" ? step.text(request) : step.text;
        if (!request.stream) return {
            model: "pinecone-fixed", usage: step.noUsage ? undefined : fixtureUsage,
            choices: [{ message: { content: text ?? "" } }]
        };
        return (async function* () {
            if (text) yield { choices: [{ delta: { content: text }, finish_reason: null }] };
            for (const [index, call] of (step.calls ?? []).entries()) {
                yield {
                    choices: [{
                        delta: {
                            tool_calls: [{
                                index, id: call.id,
                                function: { name: call.name, arguments: JSON.stringify(call.args) }
                            }]
                        }, finish_reason: null
                    }]
                };
            }
            yield { choices: [{ delta: {}, finish_reason: step.calls ? "tool_calls" : "stop" }] };
            if (!step.noUsage) yield { choices: [], model: "pinecone-fixed", usage: fixtureUsage };
        })();
    };
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

async function replayPair(t, corruptFirst = false) {
    const runId = corruptFirst ? "fixture-partial" : "fixture-success";
    const libraryDir = path.join(dir, runId);
    const store = new DocumentStore(path.join(libraryDir, "documents.json"));
    const index = new DocumentIndex(path.join(libraryDir, "index.json"));
    store.save({ name: "pinecone-incidents.md", content: incidents });
    const embedding = {
        dimensions: 3, space: "fixture-product-v1",
        embed: async () => [1, 0, 0], embedBatch: async texts => texts.map(() => [1, 0, 0])
    };
    const sandbox = new Sandbox();
    const observed = new Map(), executed = [];
    const answerFor = code => request => {
        observed.set(code, structuredClone(request.messages));
        const message = request.messages.filter(item => item.role === "tool").at(-1);
        const found = JSON.parse(message.content);
        assert.ok(found.results[0].heading.includes(code + "："));
        const ref = found.results[0].ref;
        return code === "INC-204"
            ? `小林负责：暂停新流量，执行 ./ops/cache.sh flush，确认缓存恢复后恢复流量 [${ref}]。`
            : `小周负责：只修订告警阈值，不执行缓存刷新命令 [${ref}]。`;
    };
    const scripts = Object.fromEntries(["INC-204", "INC-2047"].map(code => {
        const steps = [{ calls: [{ id: "search-1", name: "search_documents", args: { query: code } }] }];
        if (corruptFirst && code === "INC-204") {
            steps.push({ text: "小周负责 [doc-deadbeef-v1-c999]。" });
            steps.push({ text: "仍借用错误出处 [doc-deadbeef-v1-c999]。", noUsage: true });
        } else steps.push({ text: answerFor(code) });
        return [code, scripted(steps)];
    }));
    const planScript = scripted([{
        text: JSON.stringify({
            tasks: [
                { task: "查 INC-204 的负责人和处理动作" }, { task: "查 INC-2047 的负责人和处理动作" }
            ]
        })
    }]);
    // 有 run 时 Loop 只走 run.complete()，剧本必须注入 RunContext 的 create。
    const run = new RunContext({
        runId, budget: new RunBudget({ maxModelCalls: 8 }), gate: new ModelGate(2),
        create: (request, sdkOptions) => {
            const user = request.messages.find(message => message.role === "user")?.content ?? "";
            if (user.includes("分别查")) return planScript(request, sdkOptions);
            return scripts[user.includes("INC-2047") ? "INC-2047" : "INC-204"](request, sdkOptions);
        }
    });
    t.after(() => run.dispose());
    const result = await runMultiAgent("分别查 INC-204 和 INC-2047 的负责人和处理动作", () => { }, {
        runId, sessionId: "fixture-session", run, systemPrompt: "固定回放；按资料回答",
        refreshContext: async () => { },
        executeToolFn: (name, args) => sandbox.executeTool(name, args, "fixture-session", async actual => {
            assert.equal(actual, "search_documents");
            executed.push(args.query);
            return JSON.stringify(await searchDocuments(store, index, args.query, embedding, { topK: 1 }));
        })
    });
    const calls = usageLedger.read().filter(event => event.runId === runId);
    return { result, calls, executed, observed, run };
}

test("11.2 两个编号经过真实检索、子Loop与统一计量", async t => {
    const { result, calls, executed, observed, run } = await replayPair(t);
    assert.equal(result.status, "succeeded");
    assert.deepEqual(executed.sort(), ["INC-204", "INC-2047"]);
    assert.equal(calls.length, 5); // 规划1次，每项检索请求+最后答案各2次。
    assert.deepEqual(run.usage(), { limit: 8, used: 5, byOperation: { plan: 1, sub_agent: 4 } });
    assert.ok(calls.every(call => call.usageSource === "provider" && call.status === "completed"));
    assert.equal(calls.filter(call => call.operation === "plan").length, 1);
    assert.equal(result.results.length, 2);
    for (const [index, code] of ["INC-204", "INC-2047"].entries()) {
        const grade = gradeAnswer({
            answer: result.results[index].answer, messages: observed.get(code),
            requiredFacts: code === "INC-204" ? ["小林", "./ops/cache.sh flush"] : ["小周", "只修订告警阈值"]
        });
        assert.equal(grade.passed, true);
    }
    console.table(calls.map(({ operation, taskId, usageSource, tokens }) =>
        ({ operation, taskId, usageSource, inputTokens: tokens?.inputTokens })));
});

test("11.2 错出处只让对应项失败，缺usage仍保留调用", async t => {
    const { result, calls, run } = await replayPair(t, true);
    assert.equal(result.status, "partial");
    assert.equal(result.results[0].code, "COMPLETION_LIMIT");
    assert.equal(result.results[1].status, "succeeded");
    assert.ok(result.results[1].answer.includes("小周"));
    assert.equal(calls.length, 6);
    assert.equal(run.usage().used, 6);
    assert.equal(calls.filter(call => call.usageSource === "missing").length, 1);
    assert.equal(calls.filter(call => call.usageSource === "missing")[0].tokens, null);
});

test("11.2 等待第一项工具时取消，不启动同批第二项", async t => {
    const runId = "fixture-cancel";
    const run = new RunContext({
        runId, gate: new ModelGate(2),
        create: scripted([{
            calls: [
                { id: "calc-1", name: "calculate", args: { expression: "123+456" } },
                { id: "calc-2", name: "calculate", args: { expression: "579*2" } }
            ]
        }])
    });
    t.after(() => run.dispose());
    const entered = deferred(), finish = deferred(), executed = [];
    const running = runAgentLoop(
        [{ role: "system", content: "固定计算" }, { role: "user", content: "先加再乘" }],
        () => { }, () => { }, async (name, args) => {
            executed.push(args.expression);
            entered.resolve();
            await finish.promise;
            return JSON.stringify({ result: 579 });
        }, {
        runId, run
    });
    const rejection = assert.rejects(running, error => error.code === "RUN_CANCELLED");
    await entered.promise;
    run.stop("RUN_CANCELLED", "你已停止本次运行；已经完成的步骤不会撤销。");
    finish.resolve();
    await rejection;
    assert.deepEqual(executed, ["123+456"]);
    assert.equal(run.usage().used, 1);
    const calls = usageLedger.read().filter(event => event.runId === runId);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, "completed");
});

test("11.2 摘要消耗的最后一个名额能被计量，之后主请求停止", async t => {
  const runId = "fixture-summary";
  const run = new RunContext({
    runId, budget: new RunBudget({ maxModelCalls: 1 }), gate: new ModelGate(2),
    create: scripted([{ text: "此前讨论松果资料。", inspect: request => {
      assert.notEqual(request.stream, true);
    } }])
  });
  t.after(() => run.dispose());
  const current = [{ role: "system", content: "固定回放" }, { role: "user", content: "计算123+456" }];
  const old = [{ role: "user", content: "松果旧资料".repeat(300) }, { role: "assistant", content: "收到" }];
  await assert.rejects(runAgentLoop([current[0], ...old, current[1]], () => {}, () => {}, undefined, {
    runId, run, tools: [], contextState: {}, maxInputBytes: inputBytes(current) + 200
  }), error => error.code === "BUDGET_EXHAUSTED");
  const calls = usageLedger.read().filter(event => event.runId === runId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, "context_summary");
  assert.equal(calls[0].tokens.inputTokens, 21);
  assert.equal(run.usage().used, 1);
});