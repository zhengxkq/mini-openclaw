// client/src/components/Sidebar.jsx
import { useChatStore } from "../store/chat.js";

export function Sidebar() {
  const { sessions, activeSessionId, createSession, setActiveSession } = useChatStore();
  console.log('sessions', sessions);
  return (
    <div className="w-64 bg-gray-900 text-white flex flex-col h-full">
      {/* 标题 */}
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-lg font-bold">🦞 OpenClaw</h1>
        <p className="text-xs text-gray-400 mt-0.5">AI Agent Platform</p>
      </div>

      {/* 新建对话按钮 */}
      <div className="p-3">
        <button
          onClick={createSession}
          className="w-full py-2 px-3 rounded-lg border border-gray-600 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
        >
          <span>＋</span>
          <span>新对话</span>
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-2">
        {sessions.length === 0 && (
          <p className="text-xs text-gray-500 text-center mt-4">还没有对话</p>
        )}
        {sessions.map(session => (
          <button
            key={session.sessionId}
            onClick={() => setActiveSession(session.sessionId)}
            className={`
              w-full text-left px-3 py-2.5 rounded-lg mb-1 text-sm transition-colors
              ${activeSessionId === session.sessionId
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }
            `}
          >
            <div className="font-medium truncate">{session.title}</div>
            {session.lastMessage && (
              <div className="text-xs text-gray-500 truncate mt-0.5">
                {session.lastMessage}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* 底部状态 */}
      <div className="p-3 border-t border-gray-700">
        <div className="text-xs text-gray-500 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
          已连接
        </div>
      </div>
    </div>
  );
}