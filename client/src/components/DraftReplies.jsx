const labels = {
  streaming: "正在生成 · 尚未验收",
  checking: "文字已收齐 · 正在验收",
  intermediate: "过程说明 · 接下来执行工具",
  rejected: "未通过验收 · 已要求补充",
  failed: "本轮中断 · 不是完整答案"
};

export function DraftReplies({ drafts = [], finalText = "" }) {
  return <div className="w-full space-y-2">
    {drafts.map(draft => {
      // 完整答案由原正文显示；草稿不会再复制一遍。
      if (draft.status === "accepted") return null;
      const live = ["streaming", "checking"].includes(draft.status);
      // chunk 比 accepted 状态先到时，也不能暂时出现两个完整答案。
      if (live && finalText) return null;
      if (draft.status === "intermediate" && !draft.text) return null;
      const body = <>
        <p className="whitespace-pre-wrap text-sm">{draft.text || "（本轮尚无文字）"}</p>
        {draft.reason && <p className="mt-1 text-xs text-gray-500">{draft.reason}</p>}
      </>;
      const title = `第 ${draft.round} 轮：${labels[draft.status] ?? draft.status}`;
      return live
        ? <section key={draft.id} className="rounded-lg border border-blue-200 p-3">
            <p className="mb-1 text-xs text-blue-700">{title}</p>{body}
          </section>
        : <details key={draft.id} className="rounded-lg border border-gray-200 p-3">
            <summary className="cursor-pointer text-xs text-gray-600">{title}</summary>{body}
          </details>;
    })}
  </div>;
}