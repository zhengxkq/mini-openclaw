const recallReasons = {
  selected: "已选入记忆输入", below_threshold: "低于阈值",
  top_k: "超过本轮数量上限", stale: "等待期间记录已变化"
};
const emptyReasons = {
  no_candidates: "没有当前有效事件", no_selected: "候选均未保留",
  recall_failed: "召回失败，本轮未使用事件"
};

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

    {run.memoryReport && <details open className="mt-2">
      <summary>本轮事件召回</summary>
      <p>阈值 {run.memoryReport.threshold} · 最多 {run.memoryReport.topK} 条</p>
      {run.memoryReport.emptyReason && <p>
        {emptyReasons[run.memoryReport.emptyReason] ?? run.memoryReport.emptyReason}
      </p>}
      {run.memoryReport.error && <p>原因：{run.memoryReport.error}</p>}
      <div className="overflow-x-auto">
        <table className="text-left w-full">
          <thead><tr><th>主题 / 版本</th><th>范围</th><th>余弦分数</th><th>决定</th></tr></thead>
          <tbody>{run.memoryReport.candidates.map(candidate => <tr key={candidate.id}>
            <td>{candidate.key} / v{candidate.version}</td>
            <td>{candidate.scope}</td>
            <td>{candidate.score.toFixed(3)}</td>
            <td>{recallReasons[candidate.reason] ?? candidate.reason}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p>分数表示方向相似，不证明事件真实；实际输入仍受大小检查。</p>
    </details>}
  </section>;
}