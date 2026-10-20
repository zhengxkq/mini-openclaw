// client/src/store/run-labels.js
export const statusNames = {
    queued: "等待执行",
    running: "执行中",
    succeeded: "已接受",
    partial: "部分成功，仍有失败",
    failed: "失败",
    cancelled: "已停止",
    timed_out: "已超时",
    interrupted: "服务重启，已中断",
    skipped: "前置未成功，已跳过"
};

export const operationNames = {
    plan: "规划", sub_agent: "子任务", agent_loop: "主回答", context_summary: "历史摘要"
};