// client/src/components/ChatWindow.jsx
import { useEffect, useRef } from "react";
import { useChatStore } from "../store/chat.js";
import { useSSE } from "../hooks/useSSE.js";
import { MessageItem } from "./MessageItem.jsx";
import { InputBar } from "./InputBar.jsx";

export function ChatWindow({ sessionId }) {
  const { getMessages, addUserMessage, updateSessionTitle } = useChatStore();
  const messages = getMessages(sessionId);
  const bottomRef = useRef(null);
  console.log("[ChatWindow] sessionId:", sessionId); // ← 加这行
  // 建立 SSE 连接
  useSSE(sessionId);

  // 新消息时自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isStreaming = messages.some(m => m.isStreaming);

  const handleSend = async (text) => {
    // 第一条消息自动设为会话标题
    if (messages.length === 0) {
      updateSessionTitle(sessionId, text.slice(0, 20));
    }

    addUserMessage(sessionId, text);

    await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text })
    });
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <div className="text-5xl mb-4">🦞</div>
            <p className="text-lg font-medium text-gray-500">我是 Molty</p>
            <p className="text-sm mt-1">有什么可以帮你的？</p>
          </div>
        )}
        {messages.map(message => (
          <MessageItem key={message.id} message={message} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 输入框 */}
      <InputBar onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}