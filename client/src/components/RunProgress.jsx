export function RunProgress({ run }) {
  if (!run) return null;
  return <section className="text-xs text-gray-500 border-l-2 pl-3 my-2">
    <p>第 {run.round} 轮 · {run.phase}</p>
    <p className="whitespace-pre-wrap">{run.draft}</p>
  </section>;
}