// client/src/components/MessageItem.jsx
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolCallCard } from "./ToolCallCard.jsx";
import { RunProgress } from "./RunProgress.jsx";
import { CitationSource } from "./CitationSource.jsx";
import { TaskProgress } from "./TaskProgress.jsx";
import { toolCallKey } from "../store/run-state.js";

const CITATION = /\[(doc-[0-9a-f]{8}-v\d+-c\d+)\]/g;

export function MessageItem({ message }) {
    const { role, content, isStreaming, toolCalls } = message;
    const isUser = role === "user";
    const [citation, setCitation] = useState(null);
    const markdown = (content ?? "").replace(CITATION, (_, ref) => ` [出处](#cite:${ref})`);
    const markdownComponents = {
        a: ({ href, children }) => href?.startsWith("#cite:") ? (
            <button type="button" onClick={() => setCitation(href.slice("#cite:".length))}
                className="mx-0.5 rounded bg-blue-100 px-1.5 text-xs text-blue-700 no-underline hover:bg-blue-200">
                {children}
            </button>
        ) : (
            <a href={href} target="_blank" rel="noreferrer">{children}</a>
        )
    };

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
                {!isUser && (message.run?.runId
                    ? <TaskProgress run={message.run} />
                    : <RunProgress run={message.run} />)}
                {/* 工具调用卡片 */}
                {toolCalls?.map(tc => (
                    <ToolCallCard key={toolCallKey(tc)} toolCall={tc} />
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
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                    {markdown}
                                </ReactMarkdown>
                                {isStreaming && (
                                    <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-middle" />
                                )}
                            </div>
                        )}
                    </div>
                )}
                {citation && (
                    <CitationSource key={citation} citation={citation} onClose={() => setCitation(null)} />
                )}
                {/* 时间戳 */}
                <span className="text-xs text-gray-400 px-1">
                    {new Date(message.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                </span>
            </div>
        </div>
    );
}