// day3-tool.mjs
import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: process.env.BASE_URL
});

// ─── 第一步：定义工具 ───────────────────────────────────────
// 这是给 AI 看的「说明书」，AI 根据这个决定要不要调、怎么调
const tools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "获取指定城市的天气信息",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "城市名称，例如：北京、上海、广州"
          },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description: "温度单位，默认 celsius"
          }
        },
        required: ["city"]   // city 是必填项
      }
    }
  }
];

// ─── 第二步：实现工具的真实逻辑 ────────────────────────────
// 现在先用假数据模拟，后面可以换成真实 API
function get_weather({ city, unit = "celsius" }) {
  const fakeData = {
    "北京": { temp: 18, condition: "晴", humidity: 40 },
    "上海": { temp: 22, condition: "多云", humidity: 65 },
    "广州": { temp: 28, condition: "小雨", humidity: 80 },
  };

  const data = fakeData[city] ?? { temp: 20, condition: "未知", humidity: 50 };
  const temp = unit === "fahrenheit" ? data.temp * 9/5 + 32 : data.temp;
  const unitLabel = unit === "fahrenheit" ? "°F" : "°C";

  return JSON.stringify({
    city,
    temperature: `${temp}${unitLabel}`,
    condition: data.condition,
    humidity: `${data.humidity}%`
  });
}

// ─── 第三步：工具执行分发器 ─────────────────────────────────
// AI 可能要调多个工具，这里统一处理
function executeTool(name, args) {
  console.log(`\n[工具执行] ${name}(${JSON.stringify(args)})`);

  if (name === "get_weather") return get_weather(args);

  return JSON.stringify({ error: `未知工具: ${name}` });
}

// ─── 第四步：单轮 Tool Use 流程 ─────────────────────────────
async function main() {
  const messages = [
    { role: "system", content: "你是 Molty，一个简洁的助手。回答时用工具获取真实数据。" },
    { role: "user", content: "北京今天天气怎么样？" }
  ];

  console.log("用户：北京今天天气怎么样？\n");

  // 第一次调用：带上工具列表
  const response1 = await client.chat.completions.create({
    model: process.env.MODEL,
    messages,
    tools  // 把工具告诉 AI
  });

  const choice = response1.choices[0];
  console.log("finish_reason:", choice.finish_reason);  // 应该是 "tool_calls"
  console.log("AI 想调用的工具:", JSON.stringify(choice.message.tool_calls, null, 2));

  // 判断 AI 是否要调工具
  if (choice.finish_reason !== "tool_calls") {
    console.log("AI 没有调工具，直接回答：", choice.message.content);
    return;
  }

  // 把 AI 的「我要调工具」这条消息加入历史
  messages.push(choice.message);

  // 执行 AI 要求的所有工具
  for (const toolCall of choice.message.tool_calls) {
    const args = JSON.parse(toolCall.function.arguments);
    const result = executeTool(toolCall.function.name, args);

    // 把工具结果加入历史——注意 role 是 "tool"
    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,  // 必须对应，AI 靠这个知道哪个结果对应哪个工具调用
      content: result
    });
  }

  // 第二次调用：带上工具结果，让 AI 给出最终回答
  const response2 = await client.chat.completions.create({
    model: process.env.MODEL,
    messages,
    tools
  });

  console.log("\nfinish_reason:", response2.choices[0].finish_reason);  // 应该是 "stop"
  console.log("\nAI 最终回答：", response2.choices[0].message.content);

  // 看看完整的 messages 历史长什么样
  console.log("\n=== 完整消息历史 ===");
  messages.forEach((m, i) => {
    console.log(`[${i}] role: ${m.role}`);
  });
}

main();