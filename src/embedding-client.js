// src/embedding-client.js
import OpenAI from "openai";
import { AgentRunError } from "./agent/run-policy.js";
import { assertVector } from "./agent/vector-math.js";

// 对话和 embedding 用不同的 key 和 base URL
let embeddingClient;
const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL;

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-v3";
const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS ?? "1024");
export const EMBEDDING_SPACE = JSON.stringify(["openai-compatible", EMBEDDING_BASE_URL,
    EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, process.env.EMBEDDING_REVISION ?? "1"]);


function getEmbeddingClient() {
    if (!process.env.EMBEDDING_API_KEY || !EMBEDDING_BASE_URL ||
        !Number.isInteger(EMBEDDING_DIMENSIONS) || EMBEDDING_DIMENSIONS < 1) {
        throw new AgentRunError("EMBEDDING_CONFIG", "检查 embedding 的 key、端点与整数维度配置。");
    }
    embeddingClient ??= new OpenAI({
        apiKey: process.env.EMBEDDING_API_KEY, baseURL: EMBEDDING_BASE_URL
    });
    return embeddingClient;
}

export function readEmbeddingResponse(response, count, dimensions) {
  if (!Number.isInteger(count) || count < 1 || !Array.isArray(response?.data) ||
      response.data.length !== count) {
    throw new AgentRunError("EMBEDDING_RESPONSE_INVALID", "向量响应条数与输入不一致。");
  }
  const vectors = new Array(count);
  const seen = new Set();
    for (const item of response.data) {
    if (!Number.isInteger(item?.index) || item.index < 0 || item.index >= count || seen.has(item.index)) {
      throw new AgentRunError("EMBEDDING_RESPONSE_INVALID", "向量响应编号缺失、重复或越界。");
    }
    assertVector(item.embedding, dimensions);
    seen.add(item.index);
    vectors[item.index] = item.embedding;
  }
  return vectors;
}

async function requestEmbeddings(input, count) {
  const transport = getEmbeddingClient();
  let response;
  try {
    response = await transport.embeddings.create({
      model: EMBEDDING_MODEL, input, dimensions: EMBEDDING_DIMENSIONS
    });
  } catch {
    throw new AgentRunError("EMBEDDING_UNAVAILABLE", "向量服务本次请求失败，暂不使用事件记忆。");
  }
  return readEmbeddingResponse(response, count, EMBEDDING_DIMENSIONS);
}

// 生成单条文本的 embedding 向量
export async function embed(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new AgentRunError("EMBEDDING_INPUT_INVALID", "向量输入必须是非空文字。");
  }
  const vectors = await requestEmbeddings(text, 1);
  return vectors[0];
}



// 本地批次上限 10，超量明确拒绝
export async function embedBatch(texts) {
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > 10 ||
      !Array.from(texts).every(text => typeof text === "string" && text.trim())) {
    throw new AgentRunError("EMBEDDING_INPUT_INVALID", "本接口每批接受 1 到 10 条非空文字。");
  }
  return requestEmbeddings(texts, texts.length);
}

export { EMBEDDING_DIMENSIONS };