// src/config/paths.js
// 统一管理所有数据目录路径
// 优先读 DATA_DIR 环境变量（Docker 部署用），没有就用本地默认路径

import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../");
// 根目录：所有数据的起点
const ROOT = process.env.DATA_DIR ?? path.join(os.homedir(), ".my-openclaw");

export const paths = {
  // 根目录
  root: ROOT,

  // Agent 相关
  agentDir:    (agentId = "default") => path.join(ROOT, "agents", agentId),
  soulFile:    (agentId = "default") => path.join(ROOT, "agents", agentId, "soul.md"),
  builtinSkillsDir:   (agentId = "default") => path.join(PROJECT_ROOT, "agent", agentId, "skills"),
  userSkillsDir: (agentId = "default") =>
    path.join(ROOT, "agents", agentId, "skills"),

  // Session 相关
  sessionsDir: (agentId = "default") => path.join(ROOT, "agents", agentId, "sessions"),
  sessionFile: (agentId, sessionId)  => path.join(ROOT, "agents", agentId, "sessions", `${sessionId}.jsonl`),

  // 其他数据文件
  remindersFile: path.join(ROOT, "reminders.json"),
  costsFile:     path.join(ROOT, "costs.json"),

  // 日志和追踪
  logsDir:   path.join(ROOT, "logs"),
  tracesDir: path.join(ROOT, "traces"),
};

// 确保目录存在（启动时调用一次）
export function ensureDataDirs() {
  const dirs = [
    ROOT,
    paths.agentDir(),
    paths.sessionsDir(),
    paths.userSkillsDir(),
    paths.logsDir,
    paths.tracesDir,
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
  console.log(`[Paths] 数据目录: ${ROOT}`);
}