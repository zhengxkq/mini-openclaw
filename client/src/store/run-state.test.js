import test from "node:test";
import assert from "node:assert/strict";
import { useChatStore } from "./chat.js";
import { mergeRunEvent, toolCallKey } from "./run-state.js";
import { handleEvent } from "../hooks/useSSE.js";

function messageFor(t) {
    const previous = useChatStore.getState();
    const sessionId = "day09-ui";
    const messageId = "answer-1";
    useChatStore.setState({
        sessions: [],
        activeSessionId: sessionId,
        messages: {
            [sessionId]: [{
                id: messageId, role: "assistant", content: "",
                isStreaming: true, toolCalls: [], timestamp: "2026-10-16T00:00:00Z"
            }]
        }
    });
    t.after(() => useChatStore.setState(previous, true));
    return {
        store: useChatStore.getState(), sessionId, messageId,
        read: () => useChatStore.getState().messages[sessionId][0]
    };
}

test("9.4 子任务交错更新，不覆盖父任务和另一项", t => {
    const { store, sessionId, messageId, read } = messageFor(t);
    const send = event => store.applyRunEvent(sessionId, messageId, event);
    const runId = "run-ui-1";
    send({ runId, status: "running", phase: "正在执行子任务" });
    send({
        runId, taskId: "t1", task: "查询 INC-204",
        status: "queued", phase: "等待执行"
    });
    send({
        runId, taskId: "t2", task: "查询 INC-2047",
        status: "queued", phase: "等待执行"
    });
    send({
        runId, taskId: "t1", status: "running", round: 1,
        phase: "正在请求模型", draft: "INC-204 的负责人是"
    });
    send({
        runId, taskId: "t2", status: "running", round: 2,
        phase: "正在验收回答", draft: "INC-2047 的处理要求是"
    });
    send({
        runId, taskId: "t1", status: "succeeded",
        phase: "子任务已完成", draft: "", answer: "INC-204 由小林负责。"
    });
    send({
        runId, taskId: "t2", status: "failed",
        phase: "子任务失败", draft: "", code: "TOOL_FAILED", message: "工具执行失败。"
    });

    const beforeParentEnd = read().run;
    console.log("父任务尚未收到结束事件：", beforeParentEnd.status, beforeParentEnd.phase);
    console.table(Object.values(beforeParentEnd.tasks ?? {}).map(task => ({
        taskId: task.taskId, task: task.task, status: task.status, round: task.round
    })));
    assert.equal(beforeParentEnd.status, "running");
    assert.equal(beforeParentEnd.phase, "正在执行子任务");
    assert.equal(beforeParentEnd.tasks.t1.task, "查询 INC-204");
    assert.equal(beforeParentEnd.tasks.t1.round, 1);
    assert.equal(beforeParentEnd.tasks.t1.answer, "INC-204 由小林负责。");
    assert.equal(beforeParentEnd.tasks.t2.task, "查询 INC-2047");
    assert.equal(beforeParentEnd.tasks.t2.round, 2);
    assert.equal(beforeParentEnd.tasks.t2.code, "TOOL_FAILED");

    send({ runId, status: "partial", phase: "部分子任务失败" });
    assert.equal(read().run.status, "partial");
    assert.equal(read().run.tasks.t1.status, "succeeded");
    assert.equal(read().run.tasks.t2.status, "failed");
});

test("9.4 两项都叫 call-1，结束第一项不能改到第二项", t => {
    const { store, sessionId, messageId, read } = messageFor(t);
    const first = {
        runId: "run-ui-1", taskId: "t1", id: "call-1", name: "search_documents",
        args: { query: "INC-204" }, status: "running"
    };
    const second = {
        ...first, taskId: "t2", args: { query: "INC-2047" }
    };
    store.upsertToolCall(sessionId, messageId, first);
    store.upsertToolCall(sessionId, messageId, second);
    store.upsertToolCall(sessionId, messageId, { ...first, status: "done" });
    const calls = read().toolCalls;
    console.table(calls.map(call => ({
        taskId: call.taskId, id: call.id, status: call.status, query: call.args.query
    })));
    assert.equal(calls.length, 2);
    assert.equal(calls.find(call => call.taskId === "t1").status, "done");
    assert.equal(calls.find(call => call.taskId === "t2").status, "running");
    assert.equal(calls.find(call => call.taskId === "t2").args.query, "INC-2047");
});

test("9.4 单 Agent 没有归属字段，原来的更新仍能合并", t => {
    const { store, sessionId, messageId, read } = messageFor(t);
    store.applyRunEvent(sessionId, messageId, {
        round: 1, phase: "正在请求模型", draft: ""
    });
    store.applyRunEvent(sessionId, messageId, { draft: "正在计算" });
    const tool = {
        id: "single-call", name: "calculate",
        args: { expression: "123+456" }, status: "running"
    };
    store.upsertToolCall(sessionId, messageId, tool);
    store.upsertToolCall(sessionId, messageId, { ...tool, status: "done" });
    assert.equal(read().run.round, 1);
    assert.equal(read().run.phase, "正在请求模型");
    assert.equal(read().run.draft, "正在计算");
    assert.equal(read().run.runId, undefined);
    assert.equal(read().toolCalls.length, 1);
    assert.equal(read().toolCalls[0].status, "done");
});

test("9.4 合并不改旧对象，工具身份包含总任务和子任务", () => {
    const previous = {
        runId: "run-a", phase: "正在执行子任务", status: "running",
        tasks: { t1: { taskId: "t1", task: "查询 INC-204", status: "queued" } }
    };
    const snapshot = structuredClone(previous);
    const next = mergeRunEvent(previous, {
        runId: "run-a", taskId: "t1", status: "running",
        phase: "正在请求模型", round: 1, draft: "正在查询"
    });
    assert.deepEqual(previous, snapshot);
    assert.notEqual(next, previous);
    assert.notEqual(next.tasks.t1, previous.tasks.t1);
    assert.equal(next.tasks.t1.task, "查询 INC-204");
    assert.equal(next.status, "running");
    assert.equal(next.phase, "正在执行子任务");

    const parentDraft = mergeRunEvent(next, {
        runId: "run-a", phase: undefined, draft: "", promptTokens: null
    });
    assert.equal(parentDraft.phase, "正在执行子任务");
    assert.equal(parentDraft.draft, "");
    assert.equal(parentDraft.promptTokens, null);
    const childDraft = mergeRunEvent(parentDraft, {
        runId: "run-a", taskId: "t1", phase: undefined, status: undefined, draft: "找到资料"
    });
    assert.equal(childDraft.tasks.t1.phase, "正在请求模型");
    assert.equal(childDraft.tasks.t1.status, "running");
    const loopAccepted = mergeRunEvent(childDraft, {
        runId: "run-a", taskId: "t1",
        phase: "回答已接受（不代表事实已核实）", draft: ""
    });
    assert.equal(loopAccepted.tasks.t1.status, "running");
    const settled = mergeRunEvent(loopAccepted, {
        runId: "run-a", taskId: "t1", status: "succeeded",
        phase: "子答案已接受", answer: "INC-204 由小林负责。"
    });
    assert.equal(settled.tasks.t1.status, "succeeded");
    assert.equal(settled.status, "running");

    const another = mergeRunEvent(next, {
        runId: "run-b", status: "running", phase: "正在规划"
    });
    assert.deepEqual(another.tasks, {});
    const first = { runId: "run-a", taskId: "t1", id: "call-1" };
    assert.notEqual(toolCallKey(first), toolCallKey({ ...first, taskId: "t2" }));
    assert.notEqual(toolCallKey(first), toolCallKey({ ...first, runId: "run-b" }));
    assert.equal(toolCallKey({ id: "call-1" }), JSON.stringify(["", "", "call-1"]));
});

test("9.4 SSE 分发保留归属，done 不把部分成功改成成功", t => {
    const { store, sessionId, messageId, read } = messageFor(t);
    const currentMsgIdRef = { current: messageId };
    const receive = event => handleEvent(event, sessionId, store, currentMsgIdRef);
    const runId = "run-sse";
    receive({
        type: "run_event", event: {
            runId, status: "running", phase: "正在执行子任务"
        }
    });
    receive({
        type: "run_event", event: {
            runId, taskId: "t1", task: "查询 INC-204", status: "succeeded",
            phase: "子任务已完成", answer: "INC-204 由小林负责。"
        }
    });
    receive({
        type: "run_event", event: {
            runId, taskId: "t2", task: "查询 INC-2047", status: "failed",
            phase: "子任务失败", code: "TOOL_FAILED", message: "工具执行失败。"
        }
    });
    for (const taskId of ["t1", "t2"]) {
        receive({
            type: "tool_call", runId, taskId, id: "call-1",
            name: "search_documents", args: { query: taskId === "t1" ? "INC-204" : "INC-2047" },
            status: taskId === "t1" ? "done" : "error"
        });
    }
    receive({
        type: "run_event", event: {
            runId, status: "partial", phase: "部分子任务失败"
        }
    });
    receive({ type: "done" });

    console.log("SSE 结束后的父状态：", read().run.status);
    console.log("保留的工具归属：", read().toolCalls.map(call => call.taskId));
    assert.equal(read().run.status, "partial");
    assert.equal(read().isStreaming, false);
    assert.equal(currentMsgIdRef.current, null);
    assert.equal(read().run.tasks.t2.code, "TOOL_FAILED");
    assert.deepEqual(read().toolCalls.map(call => call.taskId), ["t1", "t2"]);
    assert.ok(read().toolCalls.every(call => call.runId === runId));
});


test("10.3 刷新后按记录重建，同一条记录补发两次也只处理一次", t => {
    const previous = useChatStore.getState();
    const sessionId = "day10-ui";
    useChatStore.setState({ sessions: [], activeSessionId: sessionId, messages: { [sessionId]: [] } });
    t.after(() => useChatStore.setState(previous, true));
    const store = useChatStore.getState();
    const ref = { current: null };
    const runId = "11111111-1111-4111-8111-111111111111";
    const records = [
        { type: "run_started", runId, seq: 1, at: "2026-10-19T10:00:00Z", mode: "multi", request: "分别查 INC-204 和 INC-2047" },
        { type: "run_event", runId, seq: 2, event: { runId, mode: "multi", taskId: "t1", task: "查 INC-204", status: "running" } },
        { type: "run_event", runId, seq: 3, event: { runId, mode: "multi", taskId: "t1", status: "succeeded", answer: "小林 [doc-00000001-v1-c0]" } },
        { type: "tool_call", runId, seq: 4, id: "c1", name: "search_documents", status: "done", taskId: "t1" }
    ];

    for (const record of records) handleEvent(record, sessionId, store, ref);
    for (const record of records) handleEvent(record, sessionId, store, ref);
    let messages = useChatStore.getState().messages[sessionId];
    console.table(messages.map(({ role, content, isStreaming, lastSeq }) => ({ role, content, isStreaming, lastSeq })));
    assert.deepEqual(messages.map(message => message.role), ["user", "assistant"]);
    assert.equal(messages[0].content, "分别查 INC-204 和 INC-2047");
    assert.equal(messages[1].run.tasks.t1.status, "succeeded");
    assert.equal(messages[1].toolCalls.length, 1);
    assert.equal(messages[1].isStreaming, true);

    ref.current = null;
    handleEvent({ type: "run_event", event: { runId, mode: "multi", taskId: "t2", draft: "INC-2047 的" } }, sessionId, store, ref);
    handleEvent({ type: "run_finished", runId, seq: 5, status: "cancelled", code: "RUN_CANCELLED", message: "你已停止本次运行。", usage: { used: 3, limit: 20, byOperation: {} } }, sessionId, store, ref);
    handleEvent(records[1], sessionId, store, ref);
    messages = useChatStore.getState().messages[sessionId];
    assert.equal(messages.length, 2);
    assert.equal(messages[1].run.tasks.t2.draft, "INC-2047 的");
    assert.equal(messages[1].run.tasks.t1.status, "succeeded");
    assert.equal(messages[1].run.status, "cancelled");
    assert.equal(messages[1].isStreaming, false);
    assert.equal(messages[1].content, "❌ RUN_CANCELLED：你已停止本次运行。");
});

test("10.3 断线期间发出的问题，补发时不重复显示", t => {
    const previous = useChatStore.getState();
    const sessionId = "day10-offline";
    useChatStore.setState({ sessions: [], activeSessionId: sessionId, messages: { [sessionId]: [] } });
    t.after(() => useChatStore.setState(previous, true));
    const store = useChatStore.getState();
    store.addUserMessage(sessionId, "请慢慢回答第三次");
    const runId = "22222222-2222-4222-8222-222222222222";
    handleEvent({ type: "run_started", runId, seq: 1, at: "2026-10-19T10:00:00Z", mode: "single", request: "请慢慢回答第三次" },
        sessionId, store, { current: null });
    const messages = useChatStore.getState().messages[sessionId];
    assert.deepEqual(messages.map(message => message.role), ["user", "assistant"]);
    assert.equal(messages[1].run.runId, runId);
});