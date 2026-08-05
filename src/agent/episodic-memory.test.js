// src/agent/episodic-memory.test.js
import { EpisodicMemory } from "./episodic-memory.js";

const memory = new EpisodicMemory();

console.log("=== 存入 episode ===\n");

await memory.ingest("test-1", [
  { role: "user", content: "帮我对比 React 和 Vue 的区别" },
  { role: "assistant", content: "React 用 JSX，Vue 用模板语法。React 更灵活但学习曲线更陡..." }
]);

await memory.ingest("test-2", [
  { role: "user", content: "Docker 构建一直失败，报 OOM killed" },
  { role: "assistant", content: "服务器内存不足，需要加 swap 空间。执行 fallocate -l 2G /swapfile..." }
]);

await memory.ingest("test-3", [
  { role: "user", content: "今天晚上吃什么" },
  { role: "assistant", content: "可以试试麻辣香锅或者日式拉面" }
]);

console.log("\n=== 检索测试 ===\n");

const results1 = await memory.recall("我在准备前端面试，React 相关的知识点");
console.log("\n查询: 前端面试 React");
console.log("结果:", results1.map(r => `[${r.score.toFixed(3)}] ${r.summary}`));

const results2 = await memory.recall("部署遇到问题了");
console.log("\n查询: 部署问题");
console.log("结果:", results2.map(r => `[${r.score.toFixed(3)}] ${r.summary}`));

console.log("\n=== 统计 ===");
console.log(memory.stats);

console.log("\n=== 格式化输出 ===");
console.log(memory.formatForPrompt(results1));