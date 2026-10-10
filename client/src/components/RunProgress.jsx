export function RunProgress({ run }) {
  if (!run) return null;
  return <section className="text-xs text-gray-500 border-l-2 pl-3 my-2">
    <p>第 {run.round} 轮 · {run.phase}</p>
    <p className="whitespace-pre-wrap">{run.draft}</p>
    <p>本轮实际输入 Token：{run.promptTokens ?? "供应商未返回"}</p>
    {run.context && <p>
      本次发送 {run.context.messageCount} 条消息 · 输入 {run.context.inputBytes} / {run.context.maxInputBytes} 字节
      · 省略 {run.context.removedTurns} 组旧对话
      · 摘要：{run.context.summaryUsed ? "已采用" : "未采用"}
    </p>}
  </section>;
}