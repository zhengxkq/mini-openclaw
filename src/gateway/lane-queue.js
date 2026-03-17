// src/gateway/lane-queue.js

export class LaneQueue {
  #queue = [];    // 等待执行的任务列表
  #running = false; // 当前是否有任务在执行

  // 把一个任务加入队列
  // task 是一个返回 Promise 的函数
  // 返回一个 Promise，任务完成时 resolve，失败时 reject
  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ task, resolve, reject });
      this.#drain();
    });
  }

  // 尝试消费队列
  async #drain() {
    // 如果已经有任务在跑，什么都不做——等它完成后会自动触发下一个
    if (this.#running) return;

    // 取出队列头部的任务
    const next = this.#queue.shift();
    if (!next) return; // 队列空了，结束

    this.#running = true;

    try {
      const result = await next.task(); // 等待任务完成
      next.resolve(result);             // 通知调用方成功
    } catch (e) {
      next.reject(e);                   // 通知调用方失败
    } finally {
      this.#running = false;
      this.#drain(); // 递归：处理下一个任务
    }
  }

  // 当前队列里有几个任务在等待
  get pendingCount() {
    return this.#queue.length;
  }

  // 当前是否有任务在执行
  get isRunning() {
    return this.#running;
  }
}