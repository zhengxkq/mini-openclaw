import { ProceduralMemory } from "./procedural-memory.js";

const memory = new ProceduralMemory();

console.log("=== 当前规则 ===");
console.log(memory.read());

console.log("\n=== 添加规则 ===");
memory.addRule("回复不使用 emoji");
memory.addRule("代码块必须加注释");
memory.addRule("回复不使用 emoji"); // 重复添加，应该跳过

console.log("\n=== 列出用户规则 ===");
console.log(memory.listUserRules());

console.log("\n=== 删除规则 ===");
memory.removeRule("emoji");

console.log("\n=== 删除后的规则 ===");
console.log(memory.listUserRules());

console.log("\n=== 格式化输出 ===");
console.log(memory.formatForPrompt());