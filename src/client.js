import "dotenv/config";
import OpenAI from "openai";

if (!process.env.DASHSCOPE_API_KEY) {
  throw new Error("缺少环境变量 DASHSCOPE_API_KEY，请检查 .env 文件");
}
if (!process.env.BASE_URL) {
  throw new Error("缺少环境变量 BASE_URL，请检查 .env 文件");
}
if (!process.env.MODEL) {
  throw new Error("缺少环境变量 MODEL，请检查 .env 文件");
}

export const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: process.env.BASE_URL
});

export const MODEL = process.env.MODEL;