// src/agent/episodic-memory.js
// Episodic Memory：存储和检索历史对话事件
import fs from "fs";
import path from "path";
import { paths } from "../config/paths.js";
import { embed } from "../embedding-client.js";
import { client, MODEL } from "../client.js";

export class EpisodicMemory {
  #episodesFile;
  #episodes = []; // 内存缓存

  constructor() {
    this.#episodesFile = path.join(paths.root, "episodes.json");
    this.#load();
  }

  // ── 摄入：对话结束后提取 episode ────────────────────────────
  async ingest(sessionId, messages) {
    // 过滤出本次对话的用户和助手消息
    const conversation = messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => `${m.role === "user" ? "用户" : "Agent"}：${m.content}`)
      .join("\n");

    if (conversation.length < 20) return; // 太短不值得存

    // 用 LLM 提取 episode 摘要
    const summary = await this.#extractSummary(conversation);
    if (!summary) return;

    // 生成 embedding 向量
    const vector = await embed(summary);

    const episode = {
      id: `ep-${Date.now()}`,
      sessionId,
      summary,
      vector,
      timestamp: new Date().toISOString(),
      // 重要性评分：由 LLM 在摘要时给出
      importance: this.#estimateImportance(summary)
    };

    this.#episodes.push(episode);
    this.#save();

    console.log(`[EpisodicMemory] 新 episode 存入: ${summary.slice(0, 50)}...`);
    return episode;
  }

  // ── 检索：找到和当前查询最相关的历史 episode ─────────────────
  async recall(query, topK = 3) {
    if (this.#episodes.length === 0) return [];

    // 把查询文本向量化
    const queryVector = await embed(query);

    // 计算每个 episode 的综合得分
    const scored = this.#episodes.map(ep => {
      // 余弦相似度
      const similarity = this.#cosineSimilarity(queryVector, ep.vector);

      // 时间衰减：越久远得分越低
      const ageHours = (Date.now() - new Date(ep.timestamp).getTime()) / (1000 * 60 * 60);
      const timeDecay = Math.exp(-ageHours / (24 * 30)); // 30 天半衰期

      // 综合得分 = 相似度 * 0.7 + 时间新鲜度 * 0.2 + 重要性 * 0.1
      const score = similarity * 0.7 + timeDecay * 0.2 + ep.importance * 0.1;

      return { ...ep, similarity, timeDecay, score };
    });

    // 按综合得分排序，取 Top K
    scored.sort((a, b) => b.score - a.score);

    // 过滤掉相似度太低的（< 0.3 基本不相关）
    const results = scored
      .filter(ep => ep.similarity > 0.3)
      .slice(0, topK);

    if (results.length > 0) {
      console.log(`[EpisodicMemory] 检索到 ${results.length} 条相关记忆`);
      results.forEach(r => console.log(`  - [${r.score.toFixed(3)}] ${r.summary.slice(0, 40)}...`));
    }

    return results;
  }

  // ── 格式化检索结果，用于注入 system prompt ──────────────────
  formatForPrompt(episodes) {
    if (episodes.length === 0) return "";

    const items = episodes.map((ep, i) => {
      const date = new Date(ep.timestamp).toLocaleDateString("zh-CN");
      return `${i + 1}. [${date}] ${ep.summary}`;
    }).join("\n");

    return `## 你的历史记忆\n以下是与当前对话可能相关的过往经历，可以参考但不要强行关联：\n${items}`;
  }

  // ── 整合：定期把旧的 episode 合并，减少数量 ─────────────────
  async consolidate(maxEpisodes = 100) {
    if (this.#episodes.length <= maxEpisodes) return;

    console.log(`[EpisodicMemory] 整合：${this.#episodes.length} → ${maxEpisodes}`);

    // 保留最近的和重要性高的
    const sorted = [...this.#episodes].sort((a, b) => {
      // 综合排序：重要性 + 时间
      const aScore = a.importance + (new Date(a.timestamp).getTime() / Date.now());
      const bScore = b.importance + (new Date(b.timestamp).getTime() / Date.now());
      return bScore - aScore;
    });

    this.#episodes = sorted.slice(0, maxEpisodes);
    this.#save();
    console.log(`[EpisodicMemory] 整合完成，保留 ${this.#episodes.length} 条`);
  }

  // ── 统计信息 ────────────────────────────────────────────────
  get stats() {
    return {
      totalEpisodes: this.#episodes.length,
      oldestTimestamp: this.#episodes[0]?.timestamp ?? null,
      newestTimestamp: this.#episodes.at(-1)?.timestamp ?? null
    };
  }

  // ── 私有方法 ────────────────────────────────────────────────

  // 用 LLM 提取对话摘要
  async #extractSummary(conversation) {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: `你是一个记忆提取专家。从对话中提取一条简洁的事件摘要。

要求：
- 用一两句话概括关键事件、决策或结论
- 包含具体细节（人名、项目名、数字等）
- 用过去时态描述
- 不超过 100 字

示例：
- 用户讨论了 mini-openclaw 项目的部署问题，最终通过配置 Docker swap 解决了内存不足的构建失败
- 用户准备前端面试，重点复习了 React Fiber 架构和 Hooks 原理
- 用户对比了北京和上海的天气，决定周末去上海`
          },
          {
            role: "user",
            content: `请从以下对话中提取一条事件摘要：\n\n${conversation.slice(0, 2000)}`
          }
        ],
        max_tokens: 200
      });
      return response.choices[0].message.content.trim();
    } catch (e) {
      console.error("[EpisodicMemory] 摘要提取失败:", e.message);
      return null;
    }
  }

  // 简单的重要性估算（基于文本特征）
  #estimateImportance(summary) {
    let score = 0.5; // 基础分

    // 包含决策类关键词，重要性高
    if (/决定|选择|确定|最终|结论/.test(summary)) score += 0.2;

    // 包含问题解决类关键词
    if (/解决|修复|修改|修正|搞定/.test(summary)) score += 0.15;

    // 包含数字（具体信息通常更重要）
    if (/\d+/.test(summary)) score += 0.1;

    // 包含人名或项目名（大写字母或引号）
    if (/[A-Z]{2,}|「.+」|".+"/.test(summary)) score += 0.05;

    return Math.min(score, 1.0);
  }

  // 余弦相似度计算
  #cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  // 从文件加载
  #load() {
    if (!fs.existsSync(this.#episodesFile)) {
      this.#episodes = [];
      return;
    }
    try {
      this.#episodes = JSON.parse(fs.readFileSync(this.#episodesFile, "utf-8"));
      console.log(`[EpisodicMemory] 加载了 ${this.#episodes.length} 条历史记忆`);
    } catch {
      this.#episodes = [];
    }
  }

  // 保存到文件
  #save() {
    const dir = path.dirname(this.#episodesFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.#episodesFile, JSON.stringify(this.#episodes, null, 2));
  }
}