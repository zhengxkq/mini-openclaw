// src/agent/reminder-store.js
// 把提醒存到本地 JSON 文件，重启后不丢失
import fs from "fs";
import { paths } from "../config/paths.js";

export class ReminderStore {
  #filePath;

  constructor() {
    this.#filePath = paths.remindersFile;
  }

  // 读取所有提醒
  getAll() {
    if (!fs.existsSync(this.#filePath)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.#filePath, "utf-8"));
    } catch {
      return [];
    }
  }

  // 添加一个提醒
  add({ message, triggerAt, sessionId }) {
    console.log(`[ReminderStore] 新增提醒: ${message}`);
    console.log(`[ReminderStore] 触发时间: ${triggerAt}`);
    console.log(`[ReminderStore] 解析后UTC: ${new Date(triggerAt).toISOString()}`);
    const reminders = this.getAll();

    // 如果 AI 传来的时间没有时区信息，强制当作北京时间处理
  let normalizedTime = triggerAt;
  if (!triggerAt.includes("+") && !triggerAt.endsWith("Z")) {
    // 没有时区标识，当作 +08:00 处理
    normalizedTime = triggerAt + "+08:00";
  }

  console.log(`[ReminderStore] 存储时间: ${triggerAt} → 标准化: ${normalizedTime}`);
  console.log(`[ReminderStore] 对应UTC: ${new Date(normalizedTime).toISOString()}`);

    const reminder = {
      id: Date.now().toString(),
      message,
      triggerAt: normalizedTime,  // 存标准化后的时间
      sessionId,
      done: false,
      createdAt: new Date().toISOString()
    };
    reminders.push(reminder);
    this.#save(reminders);
    return reminder;
  }

  // 取出所有到期且未完成的提醒
  getDue() {
    const now = new Date();
    return this.getAll().filter(r => !r.done && new Date(r.triggerAt) <= now);
  }

  // 标记为已完成
  markDone(id) {
    const reminders = this.getAll();
    const r = reminders.find(r => r.id === id);
    if (r) {
      r.done = true;
      this.#save(reminders);
    }
  }

  // 删除所有已完成的提醒（清理用）
  cleanup() {
    const active = this.getAll().filter(r => !r.done);
    this.#save(active);
    return active.length;
  }

  #save(reminders) {
    fs.writeFileSync(this.#filePath, JSON.stringify(reminders, null, 2));
  }
}