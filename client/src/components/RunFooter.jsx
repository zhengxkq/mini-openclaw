// client/src/components/RunFooter.jsx
import { statusNames, operationNames } from "../store/run-labels.js";

export function RunFooter({ run }) {
    if (!run?.usage) return null;
    const parts = Object.entries(run.usage.byOperation ?? {})
        .map(([operation, count]) => `${operationNames[operation] ?? operation} ${count}`);
    return <p className="px-1 text-xs text-gray-500">
        {statusNames[run.status] ?? run.status} · 本次模型请求 {run.usage.used}/{run.usage.limit} 次
        {parts.length > 0 && `（${parts.join(" · ")}）`}
    </p>;
}