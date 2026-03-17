// day3-loop.mjs
import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: process.env.BASE_URL
});

// ─── 工具定义 ────────────────────────────────────────────────
const tools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "获取指定城市的天气",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "城市名称" }
        },
        required: ["city"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_air_quality",
      description: "获取指定城市的空气质量指数 AQI",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "城市名称" }
        },
        required: ["city"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_outfit_suggestion",
      description: "根据天气和空气质量，给出今日穿衣建议",
      parameters: {
        type: "object",
        properties: {
          temperature: { type: "number", description: "温度（摄氏度）" },
          condition: { type: "string", description: "天气状况" },
          aqi: { type: "number", description: "空气质量指数" }
        },
        required: ["temperature", "condition", "aqi"]
      }
    }
  }
];

// ─── 工具实现 ────────────────────────────────────────────────
const toolImplementations = {
  get_weather({ city }) {
    const data = {
      "北京": { temperature: 8, condition: "晴" },
      "上海": { temperature: 15, condition: "阴" },
    };
    return JSON.stringify(data[city] ?? { temperature: 20, condition: "晴" });
  },

  get_air_quality({ city }) {
    const data = { "北京": { aqi: 156, level: "中度污染" }, "上海": { aqi: 45, level: "优" } };
    return JSON.stringify(data[city] ?? { aqi: 80, level: "良" });
  },

  get_outfit_suggestion({ temperature, condition, aqi }) {
    const suggestions = [];
    if (temperature < 10) suggestions.push("穿厚外套");
    else if (temperature < 20) suggestions.push("穿薄外套或毛衣");
    else suggestions.push("穿短袖即可");
    if (condition.includes("雨")) suggestions.push("带伞");
    if (aqi > 100) suggestions.push("戴口罩");
    return JSON.stringify({ suggestion: suggestions.join("，") });
  }
};

function executeTool(name, args) {
  console.log(`  ↳ 调用工具: ${name}(${JSON.stringify(args)})`);
  const fn = toolImplementations[name];
  if (!fn) return JSON.stringify({ error: `未知工具: ${name}` });
  return fn(args);
}

// ─── Agentic Loop 核心 ───────────────────────────────────────
async function runAgentLoop(userMessage) {
  const messages = [
    {
      role: "system",
      content: "你是 Molty，一个生活助手。回答用户问题时，主动调用工具获取所需数据，可以连续调用多个工具。"
    },
    { role: "user", content: userMessage }
  ];

  console.log(`\n用户：${userMessage}\n`);

  let round = 0;

  // 这就是 Agentic Loop——while true，直到 AI 说 stop
  while (true) {
    round++;
    console.log(`[第 ${round} 轮 LLM 调用]`);

    const response = await client.chat.completions.create({
      model: process.env.MODEL,
      messages,
      tools
    });

    const choice = response.choices[0];
    console.log(`  finish_reason: ${choice.finish_reason}`);

    // ── 情况1：AI 决定调工具 ──
    if (choice.finish_reason === "tool_calls") {
      // 把 AI 的消息加入历史
      messages.push(choice.message);

      // 执行所有工具调用（AI 可能一次要调多个）
      for (const toolCall of choice.message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        const result = executeTool(toolCall.function.name, args);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result
        });
      }
      // 继续循环，把工具结果喂给 AI
      continue;
    }

    // ── 情况2：AI 完成任务，给出最终回答 ──
    if (choice.finish_reason === "stop") {
      console.log(`\nMolty：${choice.message.content}`);
      console.log(`\n共经历 ${round} 轮 LLM 调用`);
      break;
    }

    // ── 情况3：遇到意外情况，防止死循环 ──
    console.log("意外的 finish_reason:", choice.finish_reason);
    break;
  }
}

// 测试：这个问题需要 AI 连续调用 3 个工具
runAgentLoop("北京今天适合出门吗？帮我综合天气、空气质量给个建议。");