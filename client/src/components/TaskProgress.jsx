import { RunProgress } from "./RunProgress.jsx";

const statusNames = {
    queued: "等待执行",
    running: "执行中",
    succeeded: "已接受",
    partial: "部分成功，仍有失败",
    failed: "失败"
};

export function TaskProgress({ run }) {
    if (!run) return null;
    const tasks = Object.values(run.tasks ?? {}).sort((a, b) =>
        Number(a.taskId.slice(1)) - Number(b.taskId.slice(1)));
    const succeeded = tasks.filter(task => task.status === "succeeded").length;
    const failed = tasks.filter(task => task.status === "failed").length;

    return <section aria-label="子任务进度" className="my-2 w-full space-y-2 text-sm">
        <div className="rounded border border-gray-200 bg-gray-50 p-3">
            <p className="font-medium">
                总任务：{statusNames[run.status] ?? run.status ?? "准备中"}
            </p>
            {run.phase && <p className="text-xs text-gray-600">{run.phase}</p>}
            {tasks.length > 0 && <p className="mt-1 text-xs text-gray-600">
                共 {tasks.length} 项 · 已接受 {succeeded} 项 · 失败 {failed} 项
            </p>}
        </div>

        {tasks.map(task => <article key={task.taskId}
            className="rounded border border-gray-200 bg-white p-3">
            <h3 className="font-medium">{task.taskId} · {task.task ?? "正在接收任务描述"}</h3>
            <p className="mt-1 text-xs">
                状态：{statusNames[task.status] ?? task.status ?? "准备中"}
            </p>
            {(task.code || task.message) && <p className="mt-1 text-xs text-red-700">
                {task.code}{task.code && task.message ? "：" : ""}{task.message}
            </p>}
            {Number.isInteger(task.round) && task.round > 0
                ? <RunProgress run={{ ...task, draft: task.status === "running" ? task.draft : "" }} />
                : task.phase && <p className="mt-1 text-xs text-gray-500">{task.phase}</p>}
            {task.status === "succeeded" && task.answer && <details className="mt-2 text-xs">
                <summary className="cursor-pointer">查看该项结果预览</summary>
                <p className="mt-1 whitespace-pre-wrap">
                    {task.answer.slice(0, 160)}{task.answer.length > 160 ? "…" : ""}
                </p>
                <p className="mt-1 text-gray-500">完整结果与出处见下方回答。</p>
            </details>}
        </article>)}
    </section>;
}