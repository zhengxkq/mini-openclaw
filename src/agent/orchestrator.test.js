// src/agent/orchestrator.test.js
import "dotenv/config";
import { runMultiAgent } from "./orchestrator.js";

async function test(label, request) {
  console.log(`\n${"★".repeat(60)}`);
  console.log(`测试：${label}`);
  console.log("★".repeat(60));

  const startTime = Date.now();

  await runMultiAgent(request, () => {}); // onChunk 只在集成时用

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n总耗时: ${elapsed}s`);
}

// 测试1：多城市天气对比（需要并行查询）
await test(
  "多城市天气对比",
  "帮我对比北京、上海、广州三个城市的天气，给出今天最适合出门的城市"
);

// 测试2：综合分析（需要多维度独立计算）
await test(
  "投资计算对比",
  "我有10000元，帮我对比：存银行年利率3%存3年、买理财年利率5%存2年、复利投资年利率8%存5年，哪个收益最高"
);