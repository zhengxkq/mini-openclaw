// src/agent/procedural-memory.js
// Procedural Memory：管理 Agent 的行为规则，Agent 自己可以修改
import fs from "fs";
import path from "path";
import { paths } from "../config/paths.js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class ProceduralMemory {
  #filePath;       // 用户数据目录的 agents.md（可写）
  #builtinPath;    // 项目代码里的 agents.md（只读，默认值）

  constructor(agentId = "default") {
    this.#filePath = paths.agentsFile(agentId);

    // 内置默认规则的路径
    const projectRoot = path.resolve(__dirname, "../../");
    this.#builtinPath = path.join(projectRoot, "src", "agent", "default", "agents.md");

    // 如果用户数据目录没有 agents.md，从内置复制一份
    this.#ensureFile();
  }

  // ── 读取当前行为规则 ────────────────────────────────────────
  read() {
    try {
      return fs.readFileSync(this.#filePath, "utf-8");
    } catch {
      return "";
    }
  }

  // ── 添加一条新规则 ──────────────────────────────────────────
  addRule(rule) {
    let content = this.read();

    // 检查是否已有类似规则（简单去重）
    if (content.includes(rule.trim())) {
      console.log(`[ProceduralMemory] 规则已存在，跳过: ${rule.slice(0, 40)}`);
      return false;
    }

    // 找到「用户偏好」section，追加到下面
    const marker = "## 用户偏好";
    if (content.includes(marker)) {
      content = content.replace(
        marker,
        `${marker}\n- ${rule.trim()}`
      );
    } else {
      // 没有 section 就直接追加到末尾
      content += `\n\n## 用户偏好\n- ${rule.trim()}`;
    }

    this.#save(content);
    console.log(`[ProceduralMemory] 新规则添加: ${rule.trim()}`);
    return true;
  }

  // ── 删除一条规则 ────────────────────────────────────────────
  removeRule(ruleFragment) {
    let content = this.read();
    const lines = content.split("\n");
    const filtered = lines.filter(line => !line.includes(ruleFragment));

    if (filtered.length === lines.length) {
      console.log(`[ProceduralMemory] 未找到匹配规则: ${ruleFragment}`);
      return false;
    }

    this.#save(filtered.join("\n"));
    console.log(`[ProceduralMemory] 规则已删除: ${ruleFragment}`);
    return true;
  }

  // ── 列出所有用户偏好规则 ────────────────────────────────────
  listUserRules() {
    const content = this.read();
    const marker = "## 用户偏好";
    const idx = content.indexOf(marker);
    if (idx === -1) return [];

    // 从 marker 开始，到下一个 ## 或文件结束
    const afterMarker = content.slice(idx + marker.length);
    const nextSection = afterMarker.indexOf("\n## ");
    const section = nextSection === -1 ? afterMarker : afterMarker.slice(0, nextSection);

    return section
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("- "))
      .map(line => line.slice(2));
  }

  // ── 格式化注入 system prompt ────────────────────────────────
  formatForPrompt() {
    const content = this.read();
    if (!content.trim()) return "";
    return `## 你的行为规则\n${content}`;
  }

  // ── 私有方法 ────────────────────────────────────────────────

  #ensureFile() {
    if (fs.existsSync(this.#filePath)) return;

    const dir = path.dirname(this.#filePath);
    fs.mkdirSync(dir, { recursive: true });

    // 有内置默认值就复制过去
    if (fs.existsSync(this.#builtinPath)) {
      fs.copyFileSync(this.#builtinPath, this.#filePath);
      console.log("[ProceduralMemory] 从内置模板初始化 agents.md");
    } else {
      // 没有内置模板就创建空文件
      fs.writeFileSync(this.#filePath, "# Agent 行为规则\n\n## 用户偏好\n");
      console.log("[ProceduralMemory] 创建空 agents.md");
    }
  }

  #save(content) {
    const dir = path.dirname(this.#filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.#filePath, content);
  }
}