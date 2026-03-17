// src/observability/logger.js
import fs from "fs";
import path from "path";
import { paths } from "../config/paths.js";

// 日志级别
export const LogLevel = {
  DEBUG: 0,
  INFO:  1,
  WARN:  2,
  ERROR: 3,
};

const LEVEL_NAMES = { 0: "DEBUG", 1: "INFO", 2: "WARN", 3: "ERROR" };
const LEVEL_COLORS = {
  0: "\x1b[36m",  // 青色
  1: "\x1b[32m",  // 绿色
  2: "\x1b[33m",  // 黄色
  3: "\x1b[31m",  // 红色
};
const RESET = "\x1b[0m";

export class Logger {
  #minLevel;
  #logFile;
  #module;

  constructor(moduleName, minLevel = LogLevel.INFO) {
    this.#module = moduleName;
    this.#minLevel = minLevel;

    // 日志文件按天分割
    const today = new Date().toISOString().slice(0, 10);
    const logDir = paths.logsDir;
    fs.mkdirSync(logDir, { recursive: true });
    this.#logFile = path.join(logDir, `${today}.jsonl`);
  }

  debug(message, data = {}) { this.#log(LogLevel.DEBUG, message, data); }
  info(message, data = {})  { this.#log(LogLevel.INFO,  message, data); }
  warn(message, data = {})  { this.#log(LogLevel.WARN,  message, data); }
  error(message, data = {}) { this.#log(LogLevel.ERROR, message, data); }

  #log(level, message, data) {
    if (level < this.#minLevel) return;

    const entry = {
      ts: new Date().toISOString(),
      level: LEVEL_NAMES[level],
      module: this.#module,
      message,
      ...data
    };

    // 控制台彩色输出
    const color = LEVEL_COLORS[level];
    const prefix = `${color}[${entry.level}][${this.#module}]${RESET}`;
    const dataStr = Object.keys(data).length > 0
      ? " " + JSON.stringify(data)
      : "";
    console.log(`${prefix} ${message}${dataStr}`);

    // 写入文件（结构化 JSONL，方便后续分析）
    fs.appendFileSync(this.#logFile, JSON.stringify(entry) + "\n");
  }
}

// 全局单例，各模块直接 import 使用
export const createLogger = (moduleName) => new Logger(moduleName);