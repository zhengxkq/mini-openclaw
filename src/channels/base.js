// src/channels/base.js
// 所有 Channel 都继承这个基类
// 规定了 Channel 必须实现的接口

export class BaseChannel {
  constructor(name) {
    this.name = name;
    // Gateway 注入这个回调，Channel 收到消息时调用
    this.onMessage = null;
  }

  // 子类必须实现：启动 Channel（开始监听消息）
  async start() {
    throw new Error(`${this.name} 必须实现 start() 方法`);
  }

  // 子类必须实现：发送消息给用户
  async send(sessionId, text) {
    throw new Error(`${this.name} 必须实现 send() 方法`);
  }

  // 子类可以覆盖：停止 Channel
  async stop() {}
}