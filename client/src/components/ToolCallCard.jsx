// client/src/components/ToolCallCard.jsx
export function ToolCallCard({ toolCall }) {
    const { name, args, status, taskId } = toolCall;

    const statusIcon = {
        running: "⚙️",
        done: "✅",
        error: "❌",
        blocked: "🛑"
    }[status] ?? "⚙️";

    const statusColor = {
        running: "border-yellow-400 bg-yellow-50",
        done: "border-green-400 bg-green-50",
        error: "border-red-400 bg-red-50",
        blocked: "border-orange-400 bg-orange-50"
    }[status] ?? "border-gray-300 bg-gray-50";

    return (
        <div className={`my-2 rounded-lg border px-3 py-2 text-sm font-mono ${statusColor}`}>
            <div className="flex items-center gap-2 font-semibold">
                <span>{statusIcon}</span>
                <span className="text-gray-700">{name}</span>
                {taskId && <span className="rounded bg-gray-100 px-1.5 text-xs text-gray-600">
                    子任务 {taskId}
                </span>}
                {status === "running" && (
                    <span className="ml-auto text-xs text-yellow-600 animate-pulse">执行中...</span>
                )}
                {status === "blocked" && (
                    <span className="ml-auto text-xs text-orange-600">读过外部资料，已暂停</span>
                )}
            </div>
            {args && Object.keys(args).length > 0 && (
                <pre className="mt-1 text-xs text-gray-500 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(args, null, 2)}
                </pre>
            )}
        </div>
    );
}