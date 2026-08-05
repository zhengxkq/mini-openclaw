// src/embedding-client.js
import OpenAI from "openai";

// 对话和 embedding 用不同的 key 和 base URL
const embeddingClient = new OpenAI({
  apiKey: process.env.EMBEDDING_API_KEY,
  baseURL: process.env.EMBEDDING_BASE_URL
});

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-v3";
const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS ?? "1024");

// 生成单条文本的 embedding 向量
export async function embed(text) {
  const response = await embeddingClient.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS
  });
  return response.data[0].embedding;
}

// 批量生成 embedding（最多 25 条，百炼限制）
export async function embedBatch(texts) {
  const response = await embeddingClient.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts.slice(0, 25),
    dimensions: EMBEDDING_DIMENSIONS
  });
  return response.data.map(d => d.embedding);
}

export { EMBEDDING_DIMENSIONS };