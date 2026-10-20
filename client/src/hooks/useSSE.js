// client/src/hooks/useSSE.js
import { useEffect, useRef, useCallback } from "react";
import { useChatStore } from "../store/chat.js";
import { watchSilence } from "./silence-watch.js";

export function useSSE(sessionId) {
    const eventSourceRef = useRef(null);
    const currentMsgIdRef = useRef(null); // 当前正在流式输出的消息 ID
    const reconnectRef = useRef(null);

    const connect = useCallback(() => {
        const store = useChatStore.getState();
        console.log("[useSSE] connect 调用, sessionId:", sessionId); // ← 加这行
        if (!sessionId) {
            console.log("[useSSE] sessionId 为空，跳过"); // ← 加这行
            return
        };
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        console.log(`[SSE] 连接: ${sessionId}`);

        // 用 fetch + ReadableStream 实现 SSE
        // 比 EventSource 更灵活，支持自定义 header
        const controller = new AbortController();
        // 开发代理在后端退出后可能既不结束也不报错；连心跳都收不到时，主动断开并重连。
        let silent = false;
        const watch = watchSilence(() => { silent = true; controller.abort(); });

        fetch(`/api/chat/stream?sessionId=${sessionId}`, {
            signal: controller.signal
        }).then(async (response) => {
            console.log("[useSSE] SSE 响应状态 :", response.status); // ← 加这行
            if (!response.ok) throw new Error(`SSE 连接失败：${response.status}`);

            store.isConnected = true;
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                watch.touch();

                buffer += decoder.decode(value, { stream: true });

                // 按双换行分割 SSE 事件
                const lines = buffer.split("\n\n");
                buffer = lines.pop() ?? ""; // 最后一段可能不完整，留到下次

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    const raw = line.slice(6).trim();
                    if (!raw || raw === "[DONE]") continue;

                    try {
                        const event = JSON.parse(raw);
                        handleEvent(event, sessionId, store, currentMsgIdRef);
                    } catch (e) {
                        console.warn("[SSE] 解析失败:", { raw, error: e });
                    }
                }
            }
            // 服务端主动关闭（例如后端重启）同样交给下面重连；重连后服务端会先补发运行记录。
            throw new Error("SSE 连接被服务端关闭");
        }).catch(e => {
            if (e.name !== "AbortError" || silent) {
                // 3 秒后重连
                setTimeout(() => {
                    reconnectRef.current?.();
                }, 3000);
            }
        }).finally(() => watch.stop());

        // 保存 controller 用于断开
        eventSourceRef.current = { close: () => { watch.stop(); controller.abort(); } };
    }, [sessionId]);

    useEffect(() => {
        reconnectRef.current = connect;
        connect();
        return () => {
            reconnectRef.current = null;

            eventSourceRef.current?.close();
        };
    }, [connect]);

    return { reconnect: useCallback(() => reconnectRef.current?.(), []) };
}

// 处理各类 SSE 事件
export function handleEvent(event, sessionId, store, currentMsgIdRef) {
    // 带 runId 的记录按运行编号找消息，不依赖“当前正在写哪条”。
    const runId = event.runId ?? event.event?.runId;
    if (runId) {
        currentMsgIdRef.current = store.messageIdForRun(sessionId, runId) ??
            (event.type === "run_started"
                ? store.openRunMessage(sessionId, event)
                : currentMsgIdRef.current);
        if (!store.acceptRecord(sessionId, currentMsgIdRef.current, event.seq)) return;
    }

    switch (event.type) {
        case "run_started":
            break;
        case "run_finished": {
            // 失败时错误提示先到，已经结束了“当前消息”；按运行编号找回这条消息。
            const messageId = store.messageIdForRun(sessionId, event.runId) ?? currentMsgIdRef.current;
            if (messageId) store.finishRun(sessionId, messageId, event);
            if (messageId === currentMsgIdRef.current) currentMsgIdRef.current = null;
            break;
        }
        case "typing":
            // 还没开始输出时，创建一个空的 AI 消息占位
            if (!currentMsgIdRef.current) {
                currentMsgIdRef.current = store.startAssistantMessage(sessionId);
            }
            break;

        case "chunk":
            // 流式 chunk，追加到当前消息
            if (!currentMsgIdRef.current) {
                currentMsgIdRef.current = store.startAssistantMessage(sessionId);
            }
            store.appendChunk(sessionId, currentMsgIdRef.current, event.text);
            break;

        case "run_event":
            if (!currentMsgIdRef.current) {
                currentMsgIdRef.current = store.startAssistantMessage(sessionId);
            }
            store.applyRunEvent(sessionId, currentMsgIdRef.current, event.event);
            break;

        case "tool_call":
            // 工具调用，附加到当前消息
            if (!currentMsgIdRef.current) {
                currentMsgIdRef.current = store.startAssistantMessage(sessionId);
            }
            store.upsertToolCall(sessionId, currentMsgIdRef.current, {
                id: event.id,
                name: event.name,
                args: event.args,
                status: event.status ?? "running",
                runId: event.runId,
                taskId: event.taskId
            });

            break;

        case "done":
            // 回复结束，清空当前消息 ID
            if (currentMsgIdRef.current) {
                store.finishStreaming(sessionId, currentMsgIdRef.current);
                currentMsgIdRef.current = null;
            }
            break;

        case "message": {
            // 完整消息（Heartbeat 推送等）
            const msgId = store.startAssistantMessage(sessionId);
            store.appendChunk(sessionId, msgId, event.text);
            store.finishStreaming(sessionId, msgId);
            break;

        }

        case "error":
            console.error("[SSE] 服务端错误:", event.message);
            if (!currentMsgIdRef.current) {
                currentMsgIdRef.current = store.startAssistantMessage(sessionId);
            }
            store.appendChunk(sessionId, currentMsgIdRef.current, `\n\n❌ ${event.message}`);
            store.finishStreaming(sessionId, currentMsgIdRef.current);
            currentMsgIdRef.current = null;
            break;
    }
}