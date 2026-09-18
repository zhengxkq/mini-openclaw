// client/src/store/chat.js
import { create } from "zustand";

// 消息的数据结构：
// {
//   id: string,
//   role: "user" | "assistant",
//   content: string,         ← 完整文本（流式拼接中）
//   isStreaming: boolean,    ← 是否还在流式输出
//   toolCalls: [],           ← 工具调用列表
//   timestamp: string
// }

// 工具调用的数据结构：
// {
//   id: string,
//   name: string,
//   args: object,
//   status: "running" | "done" | "error"
// }

export const useChatStore = create((set, get) => ({
  // ── 状态 ────────────────────────────────────────────────
  sessions: [],          // 会话列表 [{ sessionId, title, lastMessage }]
  activeSessionId: null, // 当前选中的会话 ID
  messages: {},          // sessionId → Message[]
  isConnected: false,    // SSE 是否连接
  // 获取或创建默认会话
  ensureSession: () => {
    const { sessions, activeSessionId, createSession } = get();
    if (!activeSessionId || sessions.length === 0) {
      return createSession();
    }
    return activeSessionId;
  },
  
  // ── 会话操作 ─────────────────────────────────────────────
  createSession: () => {
    const sessionId = `session-${Date.now()}`;
    const session = {
      sessionId,
      title: "新对话",
      lastMessage: "",
      createdAt: new Date().toISOString()
    };
    set(state => ({
      sessions: [session, ...state.sessions],
      activeSessionId: sessionId,
      messages: { ...state.messages, [sessionId]: [] }
    }));

    console.log('createSession', get());
    return sessionId;
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId });
  },

  updateSessionTitle: (sessionId, title) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.sessionId === sessionId ? { ...s, title } : s
      )
    }));
  },

  // ── 消息操作 ─────────────────────────────────────────────
  addUserMessage: (sessionId, content) => {
    const message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      isStreaming: false,
      toolCalls: [],
      timestamp: new Date().toISOString()
    };
    set(state => ({
      messages: {
        ...state.messages,
        [sessionId]: [...(state.messages[sessionId] ?? []), message]
      },
      sessions: state.sessions.map(s =>
        s.sessionId === sessionId
          ? { ...s, lastMessage: content.slice(0, 30) }
          : s
      )
    }));
    return message.id;
  },

  // 开始一条 AI 消息（流式输出开始时调用）
  startAssistantMessage: (sessionId) => {
    const message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      isStreaming: true,
      toolCalls: [],
      timestamp: new Date().toISOString()
    };
    set(state => ({
      messages: {
        ...state.messages,
        [sessionId]: [...(state.messages[sessionId] ?? []), message]
      }
    }));
    return message.id;
  },

  // 追加流式 chunk
  appendChunk: (sessionId, messageId, chunk) => {
    set(state => ({
      messages: {
        ...state.messages,
        [sessionId]: (state.messages[sessionId] ?? []).map(m =>
          m.id === messageId
            ? { ...m, content: m.content + chunk }
            : m
        )
      }
    }));
  },

  // 标记流式结束
  finishStreaming: (sessionId, messageId) => {
    set(state => {
      const msgs = state.messages[sessionId] ?? [];
      const msg = msgs.find(m => m.id === messageId);
      return {
        messages: {
          ...state.messages,
          [sessionId]: msgs.map(m =>
            m.id === messageId ? { ...m, isStreaming: false } : m
          )
        },
        sessions: state.sessions.map(s =>
          s.sessionId === sessionId
            ? { ...s, lastMessage: msg?.content?.slice(0, 30) ?? "" }
            : s
        )
      };
    });
  },
  applyDraftEvent: (sessionId, messageId, event) => {
    set(state => ({
      messages: {
        ...state.messages,
        [sessionId]: (state.messages[sessionId] ?? []).map(message => {
          if (message.id !== messageId) return message;
          const drafts = message.drafts ?? [];
          const previous = drafts.find(draft => draft.id === event.draftId);
          // 防止同一事件重复拼接；这不是断线重放协议。
          if (previous && event.seq <= previous.lastSeq) return message;
          const draft = { ...(previous ?? { id: event.draftId, runId: event.runId,
            round: event.round, text: "", status: "streaming" }), lastSeq: event.seq };
          if (event.action === "delta") draft.text += event.text;
          if (event.action === "status") {
            draft.status = event.status;
            draft.reason = event.reason;
          }
          return { ...message, drafts: previous
            ? drafts.map(item => item.id === draft.id ? draft : item)
            : [...drafts, draft] };
        })
      }
    }));
  },
  appendRunEvent: (sessionId, messageId, event) => {
    set(state => ({
      messages: {
        ...state.messages,
        [sessionId]: (state.messages[sessionId] ?? []).map(message => {
          if (message.id !== messageId) return message;
          const previous = message.runEvents ?? [];
          if (previous.some(e => e.runId === event.runId && e.seq === event.seq)) return message;
          return { ...message, runEvents: [...previous, event] };
        })
      }
    }));
  },
  // 添加或更新工具调用
  upsertToolCall: (sessionId, messageId, toolCall) => {
    set(state => ({
      messages: {
        ...state.messages,
        [sessionId]: (state.messages[sessionId] ?? []).map(m => {
          if (m.id !== messageId) return m;
          const existing = m.toolCalls.find(t => t.id === toolCall.id);
          const toolCalls = existing
            ? m.toolCalls.map(t => t.id === toolCall.id ? { ...t, ...toolCall } : t)
            : [...m.toolCalls, toolCall];
          return { ...m, toolCalls };
        })
      }
    }));
  },

  getMessages: (sessionId) => {
    return get().messages[sessionId] ?? [];
  }
}));