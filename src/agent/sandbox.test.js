// src/agent/sandbox.test.js
import "dotenv/config";
import { Sandbox } from "./sandbox.js";
import { executeTool } from "./tools.js";

const sandbox = new Sandbox();

// 模拟通知函数
sandbox.setNotifyFn(async (sessionId, message) => {
  console.log(`\n[模拟Telegram通知] → ${sessionId}:\n${message}\n`);
});

// ─── 测试一：权限拦截 ─────────────────────────────────────────
async function testPermissionBlock() {
  console.log("=== 测试一：权限拦截 ===\n");

  // write_file 需要 WRITE_FILE 权限，默认不在允许列表里
  const result = await sandbox.executeTool(
    "write_file",
    { path: "test.txt", content: "hello" },
    "test-session",
    executeTool
  );

  const parsed = JSON.parse(result);
  console.log("结果:", parsed);
  console.log(parsed.error?.includes("权限不足") ? "✅ 通过" : "❌ 失败");
}

// ─── 测试二：危险命令拦截 ─────────────────────────────────────
async function testDangerBlock() {
  console.log("\n=== 测试二：危险命令拦截 ===\n");

  // 临时给 execute_shell 一个实现用于测试
  const mockExecute = (toolName, args) => {
    return JSON.stringify({ output: `执行了: ${args.command}` });
  };

  const result = await sandbox.executeTool(
    "execute_shell",
    { command: "rm -rf /tmp" },
    "test-session",
    mockExecute
  );

  const parsed = JSON.parse(result);
  console.log("结果:", parsed);
  console.log(parsed.error?.includes("危险命令") ? "✅ 通过" : "❌ 失败");
}

// ─── 测试三：HITL 审批——批准 ──────────────────────────────────
async function testHITLApprove() {
  console.log("\n=== 测试三：HITL 审批（批准）===\n");

  // 用有 WRITE_FILE 权限的沙箱
  const { Permission } = await import("./permissions.js");
  const sandboxWithWrite = new Sandbox({
    allowedPermissions: new Set([Permission.WRITE_FILE])
  });

  let capturedRequestId = null;

  sandboxWithWrite.setNotifyFn(async (sessionId, message) => {
    console.log("[通知]", message);
    // 从通知消息里提取 requestId
    const match = message.match(/\/approve (\d+)/);
    if (match) {
      capturedRequestId = match[1];
      console.log(`\n[模拟用户] 自动批准，requestId: ${capturedRequestId}`);
      // 模拟用户 500ms 后回复 /approve
      setTimeout(() => {
        sandboxWithWrite.handleApproval(`/approve ${capturedRequestId}`, sessionId);
      }, 500);
    }
  });

  const mockExecute = (toolName, args) => {
    return JSON.stringify({ success: true, message: `文件 ${args.path} 写入成功` });
  };

  try {
    const result = await sandboxWithWrite.executeTool(
      "write_file",
      { path: "test.txt", content: "hello" },
      "test-session",
      mockExecute
    );
    const parsed = JSON.parse(result);
    console.log("结果:", parsed);
    console.log(parsed.success ? "✅ 通过" : "❌ 失败");
  } catch (e) {
    console.log("❌ 出错:", e.message);
  }
}

// ─── 测试四：HITL 审批——拒绝 ──────────────────────────────────
async function testHITLDeny() {
  console.log("\n=== 测试四：HITL 审批（拒绝）===\n");

  const { Permission } = await import("./permissions.js");
  const sandboxWithWrite = new Sandbox({
    allowedPermissions: new Set([Permission.WRITE_FILE])
  });

  sandboxWithWrite.setNotifyFn(async (sessionId, message) => {
    const match = message.match(/\/approve (\d+)/);
    if (match) {
      const requestId = match[1];
      console.log(`[模拟用户] 自动拒绝，requestId: ${requestId}`);
      setTimeout(() => {
        sandboxWithWrite.handleApproval(`/deny ${requestId}`, sessionId);
      }, 500);
    }
  });

  const mockExecute = () => JSON.stringify({ success: true });

  try {
    await sandboxWithWrite.executeTool(
      "write_file",
      { path: "test.txt", content: "hello" },
      "test-session",
      mockExecute
    );
    console.log("❌ 失败：应该被拒绝");
  } catch (e) {
    console.log("拒绝原因:", e.message);
    console.log(e.message.includes("拒绝") ? "✅ 通过" : "❌ 失败");
  }
}

// 顺序执行所有测试
await testPermissionBlock();
await testDangerBlock();
await testHITLApprove();
await testHITLDeny();