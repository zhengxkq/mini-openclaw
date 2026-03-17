// client/src/components/MessageItem.jsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolCallCard } from "./ToolCallCard.jsx";

export function MessageItem({ message }) {
  const { role, content, isStreaming, toolCalls } = message;
  const isUser = role === "user";

  return (
    <div className={`flex gap-3 px-4 py-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* 头像 */}
      <div className={`
        w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0
        ${isUser ? "bg-blue-500 text-white" : "bg-orange-500 text-white"}
      `}>
        {isUser ? "你" : "🦞"}
      </div>

      {/* 消息内容 */}
      <div className={`max-w-[70%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        {/* 工具调用卡片 */}
        {toolCalls?.map(tc => (
          <ToolCallCard key={tc.id} toolCall={tc} />
        ))}

        {/* 文字内容 */}
        {(content || isStreaming) && (
          <div className={`
            rounded-2xl px-4 py-2 text-sm leading-relaxed
            ${isUser
              ? "bg-blue-500 text-white rounded-tr-sm"
              : "bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm"
            }
          `}>
            {isUser ? (
              <p className="whitespace-pre-wrap">{content}</p>
            ) : (
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content}
                </ReactMarkdown>
                {isStreaming && (
                  <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            )}
          </div>
        )}

        {/* 时间戳 */}
        <span className="text-xs text-gray-400 px-1">
          {new Date(message.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}