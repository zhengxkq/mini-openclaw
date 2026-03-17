// src/agent/sandbox.js
import { toolPermissions, defaultAllowedPermissions, hitlPermissions } from "./permissions.js";
import { checkDangerPatterns } from "./danger-patterns.js";
import { HITLQueue } from "./hitl.js";

export class Sandbox {
  #allowedPermissions;
  #hitlQueue;
  #notifyFn; // 发消息给用户的函数，由外部注入

  constructor({
    allowedPermissions = defaultAllowedPermissions,
    notifyFn = null
  } = {}) {
    this.#allowedPermissions = allowedPermissions;
    this.#hitlQueue = new HITLQueue();
    this.#notifyFn = notifyFn;
  }

  // 注入通知函数（Gateway 启动后设置）
  setNotifyFn(fn) {
    this.#notifyFn = fn;
  }

  // 处理用户的 /approve 和 /deny 命令
  handleApproval(text, sessionId) {
    const approveMatch = text.match(/^\/approve\s+(\d+)$/);
    const denyMatch = text.match(/^\/deny\s+(\d+)$/);

    if (approveMatch) {
      const success = this.#hitlQueue.approve(approveMatch[1]);
      return success ? "✅ 已批准，继续执行" : "找不到对应的审批请求";
    }
    if (denyMatch) {
      const success = this.#hitlQueue.deny(denyMatch[1]);
      return success ? "❌ 已拒绝，操作取消" : "找不到对应的审批请求";
    }
    return null; // 不是审批命令
  }

  // 核心：带安全检查的工具执行
  async executeTool(toolName, args, sessionId, originalExecuteFn) {
    // ── 第一层：权限检查 ──────────────────────────────────────
    const required = toolPermissions[toolName] ?? [];
    const missingPermissions = required.filter(
      p => !this.#allowedPermissions.has(p)
    );

    if (missingPermissions.length > 0) {
      const msg = `权限不足，${toolName} 需要: ${missingPermissions.join(", ")}`;
      console.log(`[Sandbox] ❌ 权限拒绝: ${msg}`);
      return JSON.stringify({ error: msg });
    }

    // ── 第二层：危险模式检查（针对 shell 命令）────────────────
    if (toolName === "execute_shell" && args.command) {
      const danger = checkDangerPatterns(args.command);
      if (danger) {
        const msg = `危险命令被拦截: ${danger}`;
        console.log(`[Sandbox] 🚨 危险命令: ${msg}`);
        this.#logSecurityEvent({ toolName, args, reason: msg, sessionId });
        return JSON.stringify({ error: msg });
      }
    }

    // ── 第三层：HITL 审批（需要人工确认的操作）───────────────
    const requiredHitl = required.filter(p => hitlPermissions.has(p));
    if (requiredHitl.length > 0 && this.#notifyFn) {
      console.log(`[Sandbox] ⏸ HITL 审批: ${toolName}`);
      try {
        await this.#hitlQueue.requestApproval({
          toolName,
          args,
          sessionId,
          onNotify: (msg) => this.#notifyFn(sessionId, msg)
        });
        console.log(`[Sandbox] ✅ 用户批准: ${toolName}`);
      } catch (e) {
        console.log(`[Sandbox] ❌ 用户拒绝或超时: ${toolName}`);
        throw e;
      }
    }

    // ── 第四层：执行并记录 ────────────────────────────────────
    console.log(`[Sandbox] ✅ 执行: ${toolName}(${JSON.stringify(args)})`);
    this.#logSecurityEvent({ toolName, args, reason: "allowed", sessionId });

    return originalExecuteFn(toolName, args);
  }

  // 安全事件日志
  #logSecurityEvent({ toolName, args, reason, sessionId }) {
    const entry = {
      time: new Date().toISOString(),
      session: sessionId,
      tool: toolName,
      args,
      reason
    };
    // 暂时只打印，后面可以写到文件
    if (reason !== "allowed") {
      console.warn(`[SecurityLog]`, JSON.stringify(entry));
    }
  }
}