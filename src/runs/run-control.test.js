import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Console } from "node:console";

// 本文件会跑真实 Loop，它的调试打印很多。Node 测试运行器借标准输出和子进程通信，
// 并行时大量打印偶尔会把通信数据搅乱；改走标准错误后，打印照样显示在终端。
const toStderr = new Console({ stdout: process.stderr });
console.log = toStderr.log.bind(toStderr);
console.table = toStderr.table.bind(toStderr);

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-openclaw-runs-"));
const savedEnvironment = Object.fromEntries(
    ["DATA_DIR", "DASHSCOPE_API_KEY", "BASE_URL", "MODEL"].map(key => [key, process.env[key]])
);
process.env.DATA_DIR = testDataDir;
process.env.DASHSCOPE_API_KEY = "offline-test";
process.env.BASE_URL = "http://127.0.0.1:9";
process.env.MODEL = "offline-test";
after(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

const { RunContext } = await import("./run-context.js");
const { RunBudget } = await import("./run-budget.js");
const { ModelGate } = await import("./model-gate.js");
const { RunRegistry } = await import("./run-registry.js");
const { runSubAgent } = await import("../agent/sub-agent.js");
const { runAgentLoop } = await import("../agent/loop.js");
const { collectTaskResults } = await import("../agent/task-runner.js");

// 假模型：没有工具结果就要求计算，有了工具结果就给出文字答案。
function fakeModel({ sent = [], hold } = {}) {
    return async (request, { signal }) => {
        sent.push(request.messages.at(-1).content ?? "tool");
        const toolResult = request.messages.findLast(message => message.role === "tool");
        return (async function* () {
            if (hold) {
                await hold(signal);
                if (signal.aborted) return;
            }
            if (toolResult) {
                yield { choices: [{ delta: { content: "结果是 " + JSON.parse(toolResult.content).result }, finish_reason: null }] };
                yield { choices: [{ delta: {}, finish_reason: "stop" }] };
                return;
            }
            yield {
                choices: [{
                    delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "calculate", arguments: '{"expression":"1+1"}' } }] },
                    finish_reason: null
                }]
            };
            yield { choices: [{ delta: {}, finish_reason: "tool_calls" }] };
        })();
    };
}


function waitForAbort(signal) {
    return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("连接被中止")), { once: true });
    });
}

// 和 OpenAI SDK 一样：被中止时不抛错，只是安静地结束。
function endQuietlyOnAbort(signal) {
    return new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
}

test("10.1 两个子任务共用一本账，超出的请求不会发出", async t => {
    const sent = [];
    const run = new RunContext({
        budget: new RunBudget({ maxModelCalls: 3 }), gate: new ModelGate(2), create: fakeModel({ sent })
    });
    t.after(() => run.dispose());
    const plan = { tasks: [{ task: "计算第一项" }, { task: "计算第二项" }] };
    const result = await collectTaskResults(plan, {
        runTask: ({ id, task }) => runSubAgent({
            agentId: id, task, systemPrompt: "测试", run,
            executeToolFn: async () => JSON.stringify({ result: 2 })
        })
    });
    console.log("实际发出的模型请求：", sent.length, run.usage());
    console.table(result.results.map(({ id, status, code }) => ({ id, status, code })));
    assert.equal(sent.length, 3);
    assert.deepEqual(run.usage(), { limit: 3, used: 3, byOperation: { sub_agent: 3 } });
    assert.equal(result.status, "partial");
    assert.deepEqual(result.results.map(item => item.code).filter(Boolean), ["BUDGET_EXHAUSTED"]);
});

test("10.1 流没读完，名额不归还；读完才轮到下一个", async t => {
    const gate = new ModelGate(2);
    let release;
    const opened = new Promise(resolve => { release = resolve; });
    const run = new RunContext({ gate, create: fakeModel({ hold: () => opened }) });
    t.after(() => run.dispose());
    const request = { messages: [{ role: "user", content: "计算" }], stream: true };

    const first = await run.complete(request);
    const second = await run.complete(request);
    const third = run.complete(request);
    await new Promise(resolve => setImmediate(resolve));
    console.log("两条流都没读完：", gate.stats);
    assert.deepEqual(gate.stats, { limit: 2, active: 2, waiting: 1 });

    release();
    for await (const chunk of first) void chunk;
    const thirdStream = await third;
    console.log("第一条读完以后：", gate.stats);
    assert.deepEqual(gate.stats, { limit: 2, active: 2, waiting: 0 });
    for await (const chunk of second) void chunk;
    for await (const chunk of thirdStream) void chunk;
    assert.deepEqual(gate.stats, { limit: 2, active: 0, waiting: 0 });
});


test("10.2 停止信号打断正在读的流，名额立即归还", async t => {
    const gate = new ModelGate(2);
    let streaming;
    const started = new Promise(resolve => { streaming = resolve; });
    const run = new RunContext({
        gate, create: fakeModel({ hold: signal => { streaming(); return endQuietlyOnAbort(signal); } })
    });
    t.after(() => run.dispose());
    const events = [];
    const pending = runAgentLoop(
        [{ role: "system", content: "测试" }, { role: "user", content: "计算" }],
        () => { }, () => { }, async () => { throw new Error("不应执行工具"); },
        { run, contextState: {}, onEvent: event => { events.push(event.phase); } }
    );
    await started;
    assert.equal(gate.stats.active, 1);
    run.stop("RUN_CANCELLED", "你已停止本次运行。");
    await assert.rejects(pending, error => error.code === "RUN_CANCELLED");
    console.log("停止后的阶段：", events.filter(Boolean).at(-1), "并发占用：", gate.stats);
    assert.equal(events.filter(Boolean).at(-1), "已停止");
    assert.deepEqual(gate.stats, { limit: 2, active: 0, waiting: 0 });
});

test("10.2 已开始的工具做完，同一批后面的工具不再开始", async () => {
    const executed = [];
    let toolStarted, finishTool;
    const entered = new Promise(resolve => { toolStarted = resolve; });
    const gateOpen = new Promise(resolve => { finishTool = resolve; });
    const run = new RunContext({
        gate: new ModelGate(2),
        create: async () => (async function* () {
            yield {
                choices: [{
                    delta: {
                        tool_calls: [
                            { index: 0, id: "a", function: { name: "calculate", arguments: '{"expression":"1+1"}' } },
                            { index: 1, id: "b", function: { name: "calculate", arguments: '{"expression":"2+2"}' } }
                        ]
                    }, finish_reason: null
                }]
            };
            yield { choices: [{ delta: {}, finish_reason: "tool_calls" }] };
        })()
    });
    const pending = runAgentLoop(
        [{ role: "system", content: "测试" }, { role: "user", content: "两个计算" }],
        () => { }, () => { },
        async (name, args) => {
            executed.push(args.expression);
            toolStarted();
            await gateOpen;
            return JSON.stringify({ result: 2 });
        },
        { run, contextState: {} }
    );
    await entered;
    run.stop("RUN_CANCELLED", "你已停止本次运行。");
    finishTool();
    await assert.rejects(pending, error => error.code === "RUN_CANCELLED");
    run.dispose();
    console.log("实际执行过的工具：", executed);
    assert.deepEqual(executed, ["1+1"]);
});

test("10.2 排队时被停止，不占用预算；超时走同一条停止路径", async () => {
    const gate = new ModelGate(1);
    let release;
    const occupied = new Promise(resolve => { release = resolve; });
    const busy = new RunContext({ gate, create: fakeModel({ hold: () => occupied }) });
    const holding = await busy.complete({ messages: [{ role: "user", content: "占住名额" }], stream: true });

    const waiting = new RunContext({ gate, create: fakeModel() });
    const queued = waiting.complete({ messages: [{ role: "user", content: "排队" }], stream: true });
    waiting.stop("RUN_CANCELLED", "你已停止本次运行。");
    await assert.rejects(queued, error => error.code === "RUN_CANCELLED");
    assert.equal(waiting.usage().used, 0);
    waiting.dispose();

    release();
    for await (const chunk of holding) void chunk;
    busy.dispose();

    const slow = new RunContext({ gate, deadlineMs: 20, create: fakeModel({ hold: waitForAbort }) });
    const stream = await slow.complete({ messages: [{ role: "user", content: "很慢" }], stream: true });
    await assert.rejects((async () => { for await (const chunk of stream) void chunk; })(),
        error => error.code === "RUN_TIMEOUT");
    slow.dispose();
    console.log("排队被停止的预算：", waiting.usage(), "超时后并发：", gate.stats);
    assert.deepEqual(gate.stats, { limit: 1, active: 0, waiting: 0 });
});

test("10.2 只能停止自己会话里正在运行的任务", () => {
    const runs = new RunRegistry({ create: fakeModel() });
    const run = runs.start({ sessionId: "http-a", request: "计算", mode: "single" });
    assert.equal(runs.cancel(run.runId, "http-b"), false);
    assert.equal(run.signal.aborted, false);
    assert.equal(runs.cancel(run.runId, "http-a"), true);
    assert.equal(run.signal.reason.code, "RUN_CANCELLED");
    const finished = runs.fail(run, run.signal.reason);
    assert.equal(finished.status, "cancelled");
    assert.equal(runs.cancel(run.runId, "http-a"), false);
});