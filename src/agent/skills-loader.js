// src/agent/skills-loader.js
import fs from "fs";
import path from "path";
import { paths } from "../config/paths.js";


export class SkillsLoader {
    #builtinDir;
  #userDir;
  #cache = null;
  #cacheTime = 0;
  #cacheTTL = 30 * 1000;

  constructor(agentId = "default") {
    this.#builtinDir = paths.builtinSkillsDir(agentId);
    this.#userDir    = paths.userSkillsDir(agentId);
  }

  load() {
    if (this.#cache && Date.now() - this.#cacheTime < this.#cacheTTL) {
      return this.#cache;
    }

    const skills = [
      ...this.#loadFrom(this.#builtinDir, "builtin"),
      ...this.#loadFrom(this.#userDir,    "user"),
    ];

    if (skills.length === 0) {
      this.#cache = "";
      this.#cacheTime = Date.now();
      return "";
    }

    this.#cache = `## 你掌握的技能\n\n${skills.map(s => s.content).join("\n\n---\n\n")}`;
    this.#cacheTime = Date.now();

    const builtinCount = skills.filter(s => s.source === "builtin").length;
    const userCount    = skills.filter(s => s.source === "user").length;
    console.log(`[Skills] 已加载 ${skills.length} 个技能（内置 ${builtinCount}，用户 ${userCount}）`);

    return this.#cache;
  }

  list() {
    return [
      ...this.#listFrom(this.#builtinDir).map(n => ({ name: n, source: "builtin" })),
      ...this.#listFrom(this.#userDir).map(n =>    ({ name: n, source: "user" })),
    ];
  }

  #loadFrom(dir, source) {
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        const skillMd = path.join(dir, e.name, "SKILL.md");
        if (!fs.existsSync(skillMd)) return null;
        return {
          name: e.name,
          source,
          content: fs.readFileSync(skillMd, "utf-8").trim()
        };
      })
      .filter(Boolean);
  }

  #listFrom(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "SKILL.md")))
      .map(e => e.name);
  }

  invalidateCache() {
    this.#cache = null;
    this.#cacheTime = 0;
  }

}