// client/src/components/DocumentPanel.jsx
import { useEffect, useRef, useState } from "react";

export function DocumentPanel() {
  const [documents, setDocuments] = useState([]);
  const [notice, setNotice] = useState("");
  const fileInput = useRef(null);

  async function refresh() {
    const response = await fetch("/api/documents");
    const data = await response.json();
    if (!response.ok) return setNotice(`${data.code}：${data.error}`);
    setDocuments(data.documents);
  }

  useEffect(() => { refresh(); }, []);

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const response = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, content: await file.text() })
    });
    const data = await response.json();
    if (!response.ok) setNotice(`${data.code}：${data.error}`);
    else setNotice(`已导入 ${data.document.name}（v${data.document.version}）` +
      (data.indexed ? "，索引已建立" : `，但索引未建立：${data.indexError}`));
    await refresh();
  }

  async function removeDocument(doc) {
    const response = await fetch(`/api/documents/${doc.id}?version=${doc.version}`, { method: "DELETE" });
    const data = await response.json();
    setNotice(response.ok ? `已删除 ${doc.name}` : `${data.code}：${data.error}`);
    await refresh();
  }

  return (
    <div className="border-t border-gray-700 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400">📚 资料库</span>
        <button
          onClick={() => fileInput.current?.click()}
          className="text-xs px-2 py-1 rounded border border-gray-600 text-gray-300 hover:bg-gray-700"
        >
          导入 .md / .txt
        </button>
        <input ref={fileInput} type="file" accept=".md,.txt" hidden onChange={importFile} />
      </div>
      {documents.length === 0 && <p className="text-xs text-gray-500">还没有资料</p>}
      {documents.map(doc => (
        <div key={doc.id} className="flex items-center gap-1 text-xs text-gray-300 py-1">
          <span className="truncate flex-1" title={doc.name}>{doc.name}</span>
          <a href={`/api/documents/${doc.id}/chunks`} target="_blank" rel="noreferrer"
            className="text-gray-500 hover:text-white" title="查看分块">
            v{doc.version} · {doc.chunks} 块
          </a>
          <button onClick={() => removeDocument(doc)} className="text-gray-500 hover:text-red-400" title="删除">✕</button>
        </div>
      ))}
      {notice && <p className="text-xs text-gray-400 mt-2 break-all">{notice}</p>}
    </div>
  );
}