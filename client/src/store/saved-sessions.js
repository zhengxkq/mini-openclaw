// client/src/store/saved-sessions.js
const KEY = "my-openclaw.sessions";

// 浏览器禁用存储或在 Node 测试中运行时，退回为只在本页有效。
export function loadSavedSessions() {
    try {
        return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "null") ?? {};
    } catch {
        return {};
    }
}

export function saveSessions({ sessions, activeSessionId }) {
    try {
        globalThis.localStorage?.setItem(KEY, JSON.stringify({ sessions, activeSessionId }));
    } catch {
        // 存不下时不影响聊天，只是刷新后需要重新选择会话。
    }
}