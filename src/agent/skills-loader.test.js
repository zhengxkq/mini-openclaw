// src/agent/skills-loader.test.js
import { SkillsLoader } from "./skills-loader.js";

const loader = new SkillsLoader();

console.log("=== 已安装的技能 ===");
console.log(loader.list());

console.log("\n=== 注入 system prompt 的内容 ===");
const content = loader.load();
console.log(content || "（没有找到任何技能）");

console.log("\n=== 缓存测试 ===");
const start = Date.now();
loader.load(); // 第二次调用，应该命中缓存
loader.load();
loader.load();
console.log(`连续调用 3 次耗时: ${Date.now() - start}ms（命中缓存应该接近 0ms）`);