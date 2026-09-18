const labels = {
  ready: "准备下一步", sampling: "请求模型", deciding: "决定下一步",
  validating: "检查工具请求", executing: "执行工具", checking: "检查回答",
  responded: "回答已接受", failed: "运行失败", exhausted: "已达到运行上限"
};

export function RunTimeline({ events = [] }) {
  if (!events.length) return null;
  const last = events.at(-1);
  return (
    <details className="w-full rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600">
      <summary className="cursor-pointer font-medium">
        运行过程 · {labels[last.phase] ?? last.phase} · 已请求模型 {last.round} 次
      </summary>
      <ol className="mt-2 space-y-1">
        {events.map(event => (
          <li key={`${event.runId}-${event.seq}`}>
            {event.seq}. 第 {event.round} 轮 · {labels[event.phase] ?? event.phase}：{event.reason}
          </li>
        ))}
      </ol>
      {last.goalStatus === "not_checked" && (
        <p className="mt-2">已收到回答；本次没有验证业务目标是否达成。</p>
      )}
      {last.goalStatus === "verified" && (
        <p className="mt-2">本次配置的验收条件已通过。</p>
      )}
    </details>
  );
}