export function mergeRunEvent(previous, event) {
    const patch = Object.fromEntries(Object.entries(event)
        .filter(([, value]) => value !== undefined));
    const current = previous ?? {};
    if (!patch.runId) return { ...current, ...patch };

    const run = current.runId === patch.runId
        ? current
        : { runId: patch.runId, tasks: {} };

    if (!patch.taskId) {
        return { ...run, ...patch, tasks: run.tasks ?? {} };
    }

    const tasks = run.tasks ?? {};
    return {
        ...run,
        tasks: {
            ...tasks,
            [patch.taskId]: { ...tasks[patch.taskId], ...patch }
        }
    };
}

export function toolCallKey(toolCall) {
    return JSON.stringify([
        toolCall.runId ?? "",
        toolCall.taskId ?? "",
        toolCall.id
    ]);
}