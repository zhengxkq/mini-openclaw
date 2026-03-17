// src/agent/memory.js
import fs from "fs";
import path from "path";
import os from "os";
import { client, MODEL } from "../client.js";
import { fileURLToPath } from "url";
import { paths } from "../config/paths.js";
// 把 this.#projectSoulPath 改成：

// __dirname 在 ESM 里不能直接用，需要这样模拟
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 短期记忆的上限：超过这个轮数就触发压缩
// 每「轮」= 一条 user + 一条 assistant
const MAX_HISTORY_ROUNDS = 10;

export class MemoryManager {
  #agentDir;
  #soulPath;
  #projectSoulPath;

  constructor(agentId = "default") {
    this.#agentDir = paths.agentDir(agentId);
    
    const projectRoot = path.resolve(__dirname, "../");
    this.#projectSoulPath = path.join(projectRoot, "agent", "default", "soul.md");

    this.#soulPath = paths.soulFile(agentId);
    fs.mkdirSync(this.#agentDir, { recursive: true });
  }

  // ─── 读取 soul.md ─────────────────────────────────────────
  readSoul() {
    
    if (fs.existsSync(this.#projectSoulPath)) {
      return fs.readFileSync(this.#projectSoulPath, "utf-8");
    }
    if (fs.existsSync(this.#soulPath)) {
      return fs.readFileSync(this.#soulPath, "utf-8");
    }
    return ""; // 没有 soul.md 也能正常工作
  }

  // ─── 把新内容追加到 soul.md 的指定章节 ───────────────────
  appendToSoul(section, content) {
    let soul = this.readSoul();

    // 找到对应章节，把内容追加进去
    const sectionHeader = `## ${section}`;
    if (soul.includes(sectionHeader)) {
      soul = soul.replace(
        `## ${section}\n（暂无）`,
        `## ${section}\n${content}`
      );
      // 如果已经有内容，追加在后面
      if (!soul.includes(`## ${section}\n${content}`)) {
        soul = soul.replace(
          new RegExp(`(## ${section}[\\s\\S]*?)(\n## |$)`),
          `$1\n${content}\n$2`
        );
      }
    } else {
      // 章节不存在，追加一个新章节
      soul += `\n\n## ${section}\n${content}`;
    }

    const writePath = fs.existsSync(this.#projectSoulPath)
      ? this.#projectSoulPath
      : this.#soulPath;

    // ... 其余逻辑不变，把 writePath 用在 writeFileSync 里
    fs.writeFileSync(writePath, soul, "utf-8");
  }

  // ─── 核心：检查是否需要压缩，需要就执行 ──────────────────
  // messages: 当前 session 的历史数组（不含 system prompt）
  // 返回处理后的 messages（可能已被压缩）
  async compressIfNeeded(messages) {
    // 计算实际对话轮数（user + assistant 算一轮）
    const rounds = Math.floor(
      messages.filter(m => m.role === "user").length
    );

    if (rounds < MAX_HISTORY_ROUNDS) {
      return messages; // 还没到上限，不处理
    }

    console.log(`\n[Memory] 历史达到 ${rounds} 轮，开始压缩...`);

    // 取出最早的一半对话来压缩，保留最近的一半
    const half = Math.floor(messages.length / 2);
    const toCompress = messages.slice(0, half);
    const toKeep = messages.slice(half);

    // 让 AI 帮我们提炼摘要
    const summary = await this.#summarize(toCompress);

    console.log("[Memory] 摘要生成完成，写入 soul.md");
    console.log("[Memory] 摘要内容：", summary.slice(0, 100) + "...");

    // 把摘要写入 soul.md
    const timestamp = new Date().toLocaleDateString("zh-CN");
    this.appendToSoul(
      "历史摘要",
      `\n### ${timestamp} 的对话摘要\n${summary}`
    );

    // 返回压缩后的历史：一条摘要消息 + 保留的最近对话
    return [
      {
        role: "user",
        content: `[系统注：以下是之前对话的摘要]\n${summary}`
      },
      {
        role: "assistant",
        content: "好的，我已了解之前的对话内容。"
      },
      ...toKeep
    ];
  }

  // ─── 私有：调用 AI 生成摘要 ───────────────────────────────
  async #summarize(messages) {
    // 把对话历史格式化成文本
    const dialogText = messages
      .map(m => `${m.role === "user" ? "用户" : "AI"}：${m.content}`)
      .join("\n");

    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `你是一个专业的对话摘要助手。
请将给定的对话历史提炼成简洁的摘要，重点保留：
1. 用户透露的个人信息（姓名、职业、偏好等）
2. 重要的决定或结论
3. 需要在后续对话中记住的关键信息
摘要用第三人称描述，控制在 200 字以内，用中文。`
        },
        {
          role: "user",
          content: `请摘要以下对话：\n\n${dialogText}`
        }
      ]
    });

    return response.choices[0].message.content;
  }

  // ─── 记录用户信息到 soul.md ───────────────────────────────
  // 当 AI 发现用户透露了重要信息时调用
  async extractAndSaveUserInfo(messages) {
    if (messages.length < 4) return; // 对话太短，不值得提取

    const dialogText = messages
      .map(m => `${m.role === "user" ? "用户" : "AI"}：${m.content}`)
      .join("\n");

    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `分析对话，提取用户透露的个人信息。
只提取明确说出来的信息，不要猜测。
如果没有新信息，返回空字符串。
格式：每条信息一行，以「- 」开头。`
        },
        {
          role: "user",
          content: dialogText
        }
      ]
    });

    const info = response.choices[0].message.content.trim();
    if (info && info !== "" && info.includes("- ")) {
      console.log("[Memory] 发现用户信息，写入 soul.md");
      this.appendToSoul("用户信息", info);
    }
  }
}