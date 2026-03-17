// src/gateway/lane-queue.test.js
import { LaneQueue } from "./lane-queue.js";

// 模拟一个耗时任务
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const queue = new LaneQueue();
  const log = []; // 记录执行顺序

  console.log("=== 测试1：验证串行执行 ===\n");

  // 同时把 3 个任务塞进队列
  // 注意：这里是同时调用 enqueue，模拟「同时收到 3 条消息」
  const p1 = queue.enqueue(async () => {
    log.push("任务A 开始");
    await delay(100);
    log.push("任务A 结束");
    return "A的结果";
  });

  const p2 = queue.enqueue(async () => {
    log.push("任务B 开始");
    await delay(50);
    log.push("任务B 结束");
    return "B的结果";
  });

  const p3 = queue.enqueue(async () => {
    log.push("任务C 开始");
    await delay(80);
    log.push("任务C 结束");
    return "C的结果";
  });

  // 等待所有任务完成
  const results = await Promise.all([p1, p2, p3]);

  console.log("执行顺序：");
  log.forEach((entry, i) => console.log(`  ${i + 1}. ${entry}`));

  console.log("\n返回值：", results);

  // 验证：A结束 必须在 B开始 之前
  const aEndIndex = log.indexOf("任务A 结束");
  const bStartIndex = log.indexOf("任务B 开始");
  const isSerial = aEndIndex < bStartIndex;
  console.log("\n✅ 串行验证：", isSerial ? "通过——A 完成后 B 才开始" : "❌ 失败");

  console.log("\n=== 测试2：验证错误处理 ===\n");

  const queue2 = new LaneQueue();

  // 任务失败不影响后续任务
  const failTask = queue2.enqueue(async () => {
    throw new Error("任务故意失败");
  });

  const nextTask = queue2.enqueue(async () => {
    return "下一个任务正常完成";
  });

  // 捕获失败
  try {
    await failTask;
  } catch (e) {
    console.log("捕获到错误：", e.message);
  }

  const nextResult = await nextTask;
  console.log("后续任务结果：", nextResult);
  console.log("✅ 错误隔离验证：通过——失败任务不影响后续任务");

  console.log("\n=== 测试3：并发对比 ===\n");

  // 对比：如果不用 Lane Queue，直接并发执行会怎样
  const concurrentLog = [];

  const taskFn = (name, ms) => async () => {
    concurrentLog.push(`${name} 开始`);
    await delay(ms);
    concurrentLog.push(`${name} 结束`);
  };

  // 并发执行（不用队列）
  await Promise.all([
    taskFn("并发A", 100)(),
    taskFn("并发B", 50)(),
    taskFn("并发C", 80)(),
  ]);

  console.log("并发执行顺序（不可预测）：");
  concurrentLog.forEach((entry, i) => console.log(`  ${i + 1}. ${entry}`));
  console.log("\n→ 注意：并发模式下 B 和 C 会在 A 还没结束时就开始执行");
}

main();