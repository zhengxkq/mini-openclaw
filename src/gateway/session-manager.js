// src/gateway/session-manager.js
import { LaneQueue } from "./lane-queue.js";
import fs from "fs";
import { paths } from "../config/paths.js";

export class SessionManager {
  // sessionId → Session 对象
  #sessions = new Map();

  constructor() {
  }

  // 获取或创建 Session
  // 同一个 sessionId 始终返回同一个对象
  getOrCreate(sessionId, agentId = "default") {
    if (this.#sessions.has(sessionId)) {
      return this.#sessions.get(sessionId);
    }

    // 新 Session paths.sessionsDir(agentId)
    const transcriptDir = paths.sessionsDir(agentId);
    fs.mkdirSync(transcriptDir, { recursive: true });

    const session = {
      id: sessionId,
      agentId,
      queue: new LaneQueue(),       // 每个 Session 独立的串行队列
      messages: [],                 // 对话历史
      transcriptPath: paths.sessionFile(agentId, sessionId),
      createdAt: new Date().toISOString()
    };

    this.#sessions.set(sessionId, session);
    console.log(`[SessionManager] 新建 Session: ${sessionId}`);
    return session;
  }

  // 追加一条记录到 JSONL 日志
  // JSONL = 每行一个 JSON，适合追加写入，方便回放
  appendTranscript(session, entry) {
    const line = JSON.stringify({
      ...entry,
      timestamp: new Date().toISOString()
    }) + "\n";
    fs.appendFileSync(session.transcriptPath, line);
  }

  // 读取某个 Session 的完整日志
  readTranscript(session) {
    if (!fs.existsSync(session.transcriptPath)) return [];
    return fs.readFileSync(session.transcriptPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }

  // 当前有多少个活跃 Session
  get sessionCount() {
    return this.#sessions.size;
  }

  getAllSessionIds() {
    return [...this.#sessions.keys()];
  }
}