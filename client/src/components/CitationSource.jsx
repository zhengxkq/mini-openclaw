// client/src/components/CitationSource.jsx
import { useEffect, useState } from "react";

export function CitationSource({ citation, onClose }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    fetch(`/api/documents/sources/${citation}`)
      .then(async response => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => setState(ok ? { source: data } : { error: `${data.code}：${data.error}` }))
      .catch(() => setState({ error: "出处加载失败" }));
  }, [citation]);

  const { loading, source, error } = state;
  return (
    <div className="w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-gray-700">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold">📄 出处</span>
        {source && (
          <span className="text-gray-500">
            {source.name} · v{source.version} · 第 {source.lines} 行 · {source.heading}
          </span>
        )}
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700">关闭</button>
      </div>
      {loading && <p className="text-gray-400">加载中...</p>}
      {error && <p className="text-red-600">{error}</p>}
      {source && <pre className="whitespace-pre-wrap font-mono">{source.text}</pre>}
    </div>
  );
}