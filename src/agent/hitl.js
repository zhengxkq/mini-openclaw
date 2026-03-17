// src/agent/hitl.js

export class HITLQueue {
  // requestId → { resolve, reject, toolName, args, sessionId }
  #pending = new Map();

  // 提交一个需要审批的操作
  // 返回 Promise，用户批准后 resolve，拒绝后 reject
  async requestApproval({ toolName, args, sessionId, onNotify }) {
    const requestId = Date.now().toString();

    // 通知用户有操作需要审批
    const preview = JSON.stringify(args, null, 2);
    const message =
      `⚠️ *需要你的批准*\n\n` +
      `Agent 想要执行：\`${toolName}\`\n\n` +
      `参数：\`\`\`\n${preview}\n\`\`\`\n\n` +
      `回复：\n` +
      `✅ \`/approve ${requestId}\` 批准\n` +
      `❌ \`/deny ${requestId}\` 拒绝`;

    await onNotify(message);

    // 返回 Promise，等待用户回复
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve,
        reject,
        toolName,
        args,
        sessionId,
        createdAt: Date.now()
      });

      // 超时自动拒绝（5 分钟）
      setTimeout(() => {
        if (this.#pending.has(requestId)) {
          this.#pending.delete(requestId);
          reject(new Error("审批超时，操作已自动取消"));
        }
      }, 5 * 60 * 1000);
    });
  }

  // 用户批准
  approve(requestId) {
    const request = this.#pending.get(requestId);
    if (!request) return false;
    this.#pending.delete(requestId);
    request.resolve(true);
    return true;
  }

  // 用户拒绝
  deny(requestId) {
    const request = this.#pending.get(requestId);
    if (!request) return false;
    this.#pending.delete(requestId);
    request.reject(new Error("用户拒绝了此操作"));
    return true;
  }

  // 当前等待审批的数量
  get pendingCount() {
    return this.#pending.size;
  }
}