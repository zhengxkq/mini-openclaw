// client/src/App.jsx
import { useEffect } from "react";
import { useChatStore } from "./store/chat.js";
import { Sidebar } from "./components/Sidebar.jsx";
import { ChatWindow } from "./components/ChatWindow.jsx";

export default function App() {
  const { activeSessionId, ensureSession } = useChatStore();
  const sessionId = activeSessionId ?? ensureSession();

  // 启动时自动创建第一个会话
  useEffect(() => {
  }, []);

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        {activeSessionId ? (
          <ChatWindow sessionId={activeSessionId} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            选择或创建一个对话
          </div>
        )}
      </main>
    </div>
  );
}