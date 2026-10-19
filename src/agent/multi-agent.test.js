import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-openclaw-multi-"));
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

const { client } = await import("../client.js");
const originalCreate = client.chat.completions.create;
client.chat.completions.create = async () => {
    throw new Error("测试遗漏 createCompletion，禁止真实模型请求");
};
after(() => { client.chat.completions.create = originalCreate; });
const { runSubAgent } = await import("./sub-agent.js");
const { runAgentLoop } = await import("./loop.js");

function scriptedCompletion(steps) {
    let cursor = 0;
    return async request => {
        const step = steps[cursor++];
        if (!step) throw new Error("测试剧本没有下一轮");
        await step.inspect?.(request);
        if (!request.stream) {
            return { choices: [{ message: { content: step.text ?? "" } }] };
        }
        return (async function* () {
            if (step.text) {
                yield { choices: [{ delta: { content: step.text }, finish_reason: null }] };
            }
            for (const [index, call] of (step.calls ?? []).entries()) {
                yield {
                    choices: [{
                        delta: {
                            tool_calls: [{
                                index, id: call.id,
                                function: { name: call.name, arguments: JSON.stringify(call.args) }
                            }]
                        },
                        finish_reason: null
                    }]
                };
            }
            yield {
                choices: [{
                    delta: {},
                    finish_reason: step.finishReason ?? (step.calls ? "tool_calls" : "stop")
                }]
            };
        })();
    };
}


test("9.1 子任务等待异步工具完成，下一轮才收到字符串结果", async () => {
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const order = [];
    const events = [];
    const createCompletion = scriptedCompletion([
        {
            text: "我先计算。", calls: [{ id: "calc-1", name: "calculate", args: { expression: "2+3" } }],
            inspect: request => assert.deepEqual(request.tools.map(tool => tool.function.name),
                ["calculate", "search_documents"])
        },
        {
            text: "2 + 3 = 5。", inspect: request => {
                order.push("model:next");
                const toolResult = request.messages.find(message => message.role === "tool");
                assert.equal(typeof toolResult.content, "string");
                assert.equal(JSON.parse(toolResult.content).result, 5);
            }
        }
    ]);
    const pending = runSubAgent({
        agentId: "calc-task", task: "计算 2+3", systemPrompt: "测试计算任务",
        createCompletion,
        onEvent: event => { events.push(event); },
        executeToolFn: async (name, args) => {
            assert.equal(name, "calculate");
            assert.equal(args.expression, "2+3");
            order.push("tool:start");
            entered();
            await gate;
            order.push("tool:end");
            return JSON.stringify({ result: 5 });
        }
    });
    await Promise.race([started, pending.then(() => {
        throw new Error("子任务在工具开始前意外返回");
    })]);
    assert.deepEqual(order, ["tool:start"]);
    release();
    const answer = await pending;
    console.log("执行顺序：", order, "正式子任务结果：", answer);
    assert.deepEqual(order, ["tool:start", "tool:end", "model:next"]);
    assert.equal(answer, "2 + 3 = 5。");
    assert.ok(events.some(event => event.draft === "我先计算。"));
    assert.ok(events.every(event => event.taskId === "calc-task"));
});


test("9.1 一批含未知或副作用工具，整批零执行", async () => {
    for (const forbiddenName of ["delete_all_documents", "set_reminder"]) {
        const executed = [];
        await assert.rejects(runSubAgent({
            agentId: "batch-task", task: "计算并查资料", systemPrompt: "测试整批检查",
            createCompletion: scriptedCompletion([{
                calls: [
                    { id: "batch-calc", name: "calculate", args: { expression: "2+3" } },
                    {
                        id: "batch-forbidden", name: forbiddenName, args: {
                            message: "测试提醒", trigger_at: "2030-01-01T09:00:00+08:00", session_id: "test-session"
                        }
                    }
                ]
            }]),
            executeToolFn: async name => {
                executed.push(name);
                return JSON.stringify({ result: 5 });
            }
        }), error => error.code === "TOOL_NOT_ALLOWED");
        console.log("未开放工具：", forbiddenName, "真正执行：", executed);
        assert.deepEqual(executed, []);
    }
});

test("9.1 五轮耗尽抛错，不把草稿当作子任务结果", async () => {
    const events = [];
    let delivered;
    let executed = 0;
    const steps = Array.from({ length: 5 }, (_, index) => ({
        text: `第 ${index + 1} 轮还在计算。`,
        calls: [{ id: `loop-${index}`, name: "calculate", args: { expression: "2+3" } }]
    }));
    await assert.rejects(runSubAgent({
        agentId: "round-task", task: "计算 2+3", systemPrompt: "测试轮数边界",
        createCompletion: scriptedCompletion(steps),
        onEvent: event => { events.push(event); },
        executeToolFn: async () => {
            executed++;
            return JSON.stringify({ result: 5 });
        }
    }).then(answer => { delivered = answer; }), error => error.code === "ROUND_LIMIT");
    console.log("已执行轮数：", executed, "正式子任务结果：", delivered);
    assert.equal(executed, 5);
    assert.equal(delivered, undefined);
    assert.ok(events.some(event => event.draft?.includes("还在计算")));
    assert.equal(events.at(-1).phase, "任务失败");
});

test("9.1 非法轮数上限在请求模型前被拒绝", async () => {
    let requests = 0;
    for (const maxRounds of [0, 11, 1.5, "5"]) {
        await assert.rejects(runAgentLoop(
            [{ role: "system", content: "test" }, { role: "user", content: "你好" }],
            () => { }, () => { }, async () => "{}",
            { maxRounds, createCompletion: async () => { requests++; } }
        ), error => error.code === "INVALID_RUN_OPTIONS");
    }
    console.log("非法上限造成的模型请求数：", requests);
    assert.equal(requests, 0);
});

test("9.2 规划可以补答；合法计划才返回执行入口", async () => {
    const { planTasks } = await import("./orchestrator.js");
    const phases = [];
    const plan = await planTasks("分别查 INC-204 和 INC-2047", {
        planCompletion: scriptedCompletion([
            { text: '{"tasks":[]}' },
            { text: '{"tasks":[{"task":"查 INC-204"},{"task":"查 INC-2047"}]}' }
        ]),
        onEvent: event => { if (event.phase) phases.push(event.phase); }
    });
    console.log("规划阶段：", phases, "得到任务：", plan.tasks);
    assert.equal(plan.tasks.length, 2);
    assert.equal(plan.tasks[0].id, "t1");
});

test("9.2 两次坏计划后停止，子任务工具一次也不执行", async () => {
    const { runMultiAgent } = await import("./orchestrator.js");
    let executed = 0;
    const chunks = [];
    await assert.rejects(runMultiAgent("分别查两个编号", text => { chunks.push(text); }, {
        executeToolFn: async () => { executed++; return "不应执行"; },
        planCompletion: scriptedCompletion([
            { text: '{"tasks":[]}' },
            { text: '{"tasks":[{"task":" "}]}' }
        ]),
        createCompletion: async () => { throw new Error("不应启动子任务模型"); }
    }), error => error.code === "COMPLETION_LIMIT");
    console.log("坏计划后的工具执行次数：", executed);
    assert.equal(executed, 0);
    assert.equal(chunks.length, 0);
});

test("9.5 另一项的出处不能借用，失败项不会抹掉成功项", async () => {
    const { runMultiAgent } = await import("./orchestrator.js");
    const { Sandbox } = await import("./sandbox.js");
    const sandbox = new Sandbox();
    const refs = { "INC-204": "doc-00000001-v1-c0", "INC-2047": "doc-00000001-v1-c1" };
    const scripts = {
        "INC-204": scriptedCompletion([
            { calls: [{ id: "call-1", name: "search_documents", args: { query: "INC-204" } }] },
            { text: "小林负责 [doc-00000001-v1-c1]。" },
            { text: "仍然使用另一项的出处 [doc-00000001-v1-c1]。" }
        ]),
        "INC-2047": scriptedCompletion([
            { calls: [{ id: "call-1", name: "search_documents", args: { query: "INC-2047" } }] },
            { text: "小周负责 [doc-00000001-v1-c1]。" }
        ])
    };
    const events = [], tools = [], chunks = [], executed = [];
    const result = await runMultiAgent("分别查询两条故障", text => { chunks.push(text); }, {
        systemPrompt: "固定输入测试",
        planCompletion: scriptedCompletion([
            { text: '{"tasks":[{"task":"查 INC-204"},{"task":"查 INC-2047"}]}' }
        ]),
        createCompletion: request => {
            const task = request.messages.find(message => message.role === "user").content;
            const code = task.includes("INC-2047") ? "INC-2047" : "INC-204";
            assert.equal(request.messages.filter(message => message.role === "system").length >= 2, true);
            return scripts[code](request);
        },
        refreshContext: async (input, task) => {
            input[0] = { role: "system", content: "已刷新通用规则，当前查询：" + task };
        },
        executeToolFn: (name, args) => sandbox.executeTool(name, args, "course-day09-test",
            async actualName => {
                executed.push({ name: actualName, query: args.query });
                return JSON.stringify({
                    results: [{
                        ref: refs[args.query], text: args.query + " 的合成记录", name: "synthetic.md"
                    }]
                });
            }),
        onEvent: event => { events.push(event); },
        onToolCall: event => { tools.push(event); }
    });

    console.table(result.results);
    console.table(tools.map(({ runId, taskId, id, status }) => ({ runId, taskId, id, status })));
    assert.equal(result.status, "partial");
    assert.equal(result.results[0].code, "COMPLETION_LIMIT");
    assert.equal(result.results[1].status, "succeeded");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], result.answer);
    assert.ok(!result.answer.includes("仍然使用另一项"));
    assert.equal(executed.length, 2);
    assert.deepEqual(new Set(tools.map(event => event.taskId)), new Set(["t1", "t2"]));
    assert.ok(tools.every(event => event.id === "call-1" && event.runId === result.runId));
    assert.ok(events.every(event => event.runId === result.runId));
    assert.equal(events.at(-1).status, "partial");
});

test("9.5 空检索必须补答说明不足，已接受不等于找到了答案", async () => {
    const { runSubAgent } = await import("./sub-agent.js");
    const phases = [];
    const answer = await runSubAgent({
        agentId: "t1", task: "查 INC-9999 的负责人", systemPrompt: "固定输入测试",
        createCompletion: scriptedCompletion([
            { calls: [{ id: "empty-1", name: "search_documents", args: { query: "INC-9999" } }] },
            { text: "负责人是小林。" },
            { text: "资料不足，无法确认 INC-9999 的负责人。" }
        ]),
        executeToolFn: async () => JSON.stringify({ results: [], notice: "资料不足" }),
        onEvent: event => { if (event.phase) phases.push(event.phase); }
    });
    console.log("空检索的最终回答：", answer);
    assert.equal(answer, "资料不足，无法确认 INC-9999 的负责人。");
    assert.equal(phases.filter(phase => phase === "正在验收回答").length, 2);
});

test("9.5 工具error结果停止子Loop，不能伪装成资料不足的成功", async () => {
    const { runSubAgent } = await import("./sub-agent.js");
    const statuses = [];
    await assert.rejects(runSubAgent({
        agentId: "t1", task: "查 INC-204", systemPrompt: "固定输入测试",
        createCompletion: scriptedCompletion([
            { calls: [{ id: "error-1", name: "search_documents", args: { query: "INC-204" } }] }
        ]),
        executeToolFn: async () => JSON.stringify({ error: "合成的检索故障" }),
        onToolCall: event => { statuses.push(event.status); }
    }), error => error.code === "TOOL_FAILED");
    assert.deepEqual(statuses, ["running", "error"]);
    console.log("错误工具状态：", statuses);
});

test("9.5 两项都接受时，只交付一次按计划排列的最终报告", async () => {
    const { runMultiAgent } = await import("./orchestrator.js");
    const scripts = new Map([
        ["计算123+456", scriptedCompletion([
            { calls: [{ id: "call-1", name: "calculate", args: { expression: "123+456" } }] },
            { text: "123+456=579。" }
        ])],
        ["计算579*2", scriptedCompletion([
            { calls: [{ id: "call-1", name: "calculate", args: { expression: "579*2" } }] },
            { text: "579*2=1158。" }
        ])]
    ]);
    const chunks = [];
    const result = await runMultiAgent("分别计算123+456和579*2", text => { chunks.push(text); }, {
        systemPrompt: "固定输入测试",
        planCompletion: scriptedCompletion([
            { text: '{"tasks":[{"task":"计算123+456"},{"task":"计算579*2"}]}' }
        ]),
        createCompletion: request => {
            const task = request.messages.find(message => message.role === "user").content;
            assert.deepEqual(request.tools.map(tool => tool.function.name).sort(), ["calculate", "search_documents"]);
            return scripts.get(task)(request);
        },
        executeToolFn: async (name, args) => {
            assert.equal(name, "calculate");
            return JSON.stringify({ result: args.expression === "123+456" ? 579 : 1158 });
        }
    });
    console.log(result.answer);
    assert.equal(result.status, "succeeded");
    assert.equal(result.results.length, 2);
    assert.deepEqual(chunks, [result.answer]);
    assert.ok(result.answer.indexOf("579。") < result.answer.indexOf("1158。"));
});