// client/src/hooks/useSSE.js
import { useEffect, useRef, useCallback } from "react";
import { useChatStore } from "../store/chat.js";

export function useSSE(sessionId) {
  const eventSourceRef = useRef(null);
  const currentMsgIdRef = useRef(null); // 当前正在流式输出的消息 ID
  const store = useChatStore();

  const connect = useCallback(() => {
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

    fetch(`/api/chat/stream?sessionId=${sessionId}`, {
      signal: controller.signal
    }).then(async (response) => {
      console.log("[useSSE] SSE 响应状态 :", response.status); // ← 加这行
      if (!response.ok) {
        console.error("[SSE] 连接失败:", response.status);
        return;
      }

      store.isConnected = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

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
            console.warn("[SSE] 解析失败:", raw);
          }
        }
      }
    }).catch(e => {
      if (e.name !== "AbortError") {
        console.error("[SSE] 错误:", e);
        // 3 秒后重连
        setTimeout(() => connect(), 3000);
      }
    });

    // 保存 controller 用于断开
    eventSourceRef.current = { close: () => controller.abort() };
  }, [sessionId]);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);
}

// 处理各类 SSE 事件
function handleEvent(event, sessionId, store, currentMsgIdRef) {
  switch (event.type) {
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

    case "tool_call":
      // 工具调用，附加到当前消息
      if (!currentMsgIdRef.current) {
        currentMsgIdRef.current = store.startAssistantMessage(sessionId);
      }
      store.upsertToolCall(sessionId, currentMsgIdRef.current, {
        id: `tool-${Date.now()}`,
        name: event.name,
        args: event.args,
        status: event.status ?? "running"
      });
      break;

    case "done":
      // 回复结束，清空当前消息 ID
      if (currentMsgIdRef.current) {
        store.finishStreaming(sessionId, currentMsgIdRef.current);
        currentMsgIdRef.current = null;
      }
      break;

    case "message":
      // 完整消息（Heartbeat 推送等）
      store.startAssistantMessage(sessionId);
      const msgId = store.startAssistantMessage(sessionId);
      store.appendChunk(sessionId, msgId, event.text);
      store.finishStreaming(sessionId, msgId);
      break;

    case "error":
      console.error("[SSE] 服务端错误:", event.message);
      if (currentMsgIdRef.current) {
        store.appendChunk(sessionId, currentMsgIdRef.current, `\n\n❌ ${event.message}`);
        store.finishStreaming(sessionId, currentMsgIdRef.current);
        currentMsgIdRef.current = null;
      }
      break;
  }
}