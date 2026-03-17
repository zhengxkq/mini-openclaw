import { ReminderStore } from "./reminder-store.js";
import { costTracker } from "../observability/cost-tracker.js";
import { tavily } from "@tavily/core";


const reminderStore = new ReminderStore();
// src/agent/tools.js
// 工具定义 + 工具实现，统一管理
// 以后每加一个新工具，只需要改这一个文件
// ─── 工具定义（给 AI 看的说明书）────────────────────────────
export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "搜索互联网获取最新信息，适合查询新闻、实时数据、不确定的事实",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词，用中文或英文都可以"
          },
          max_results: {
            type: "number",
            description: "返回结果数量，默认3，最多5"
          }
        },
        required: ["query"]
      }
    }
  },
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
            description: "城市名称，例如：北京、上海"
          }
        },
        required: ["city"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取本地文件的内容",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "文件路径，例如：./readme.txt"
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "执行数学计算，输入一个数学表达式",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "数学表达式，例如：(10 + 20) * 3"
          }
        },
        required: ["expression"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description: "为用户设置一个定时提醒",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "提醒内容"
          },
          trigger_at: {
            type: "string",
            description: "触发时间，ISO 格式，例如 2026-03-09T15:00:00"
          },
          session_id: {
            type: "string",
            description: "要推送提醒的 session ID"
          }
        },
        required: ["message", "trigger_at", "session_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_reminders",
      description: "列出当前所有未完成的提醒",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_cost_summary",
      description: "查询今日 API 费用统计和使用情况",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  }
];

// ─── 工具实现（真正干活的代码）──────────────────────────────
import fs from "fs";

const toolImplementations = {
  get_weather({ city }) {
    // 现在用假数据，后面可以换成真实天气 API
    const data = {
      "北京": { temp: 8,  condition: "晴",  humidity: "30%" },
      "上海": { temp: 15, condition: "多云", humidity: "60%" },
      "广州": { temp: 25, condition: "小雨", humidity: "80%" },
    };
    const result = data[city] ?? { temp: 20, condition: "未知", humidity: "50%" };
    return JSON.stringify({ city, ...result });
  },

  read_file({ path: filePath }) {
    // 安全限制：只允许读当前目录下的文件，不允许路径穿越
    if (filePath.includes("..") || filePath.startsWith("/")) {
      return JSON.stringify({ error: "不允许读取该路径" });
    }
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.stringify({ content: content.slice(0, 2000) }); // 最多返回 2000 字符
    } catch {
      return JSON.stringify({ error: `文件不存在: ${filePath}` });
    }
  },

  calculate({ expression }) {
    try {
      // 安全限制：只允许数字和运算符，防止代码注入
      if (!/^[\d\s\+\-\*\/\(\)\.]+$/.test(expression)) {
        return JSON.stringify({ error: "表达式包含非法字符" });
      }
      const result = Function(`"use strict"; return (${expression})`)();
      return JSON.stringify({ expression, result });
    } catch {
      return JSON.stringify({ error: "计算失败，请检查表达式" });
    }
  },

  set_reminder({message, trigger_at, session_id}) {
    try {
      const reminder = reminderStore.add({
        message,
        triggerAt: trigger_at,
        sessionId: session_id 
      });

      return JSON.stringify({
        success: true,
        id: reminder.id,
        message: `提醒已设置：${message}，将在 ${trigger_at} 触发`
      });

    } catch(e) {
      return JSON.stringify({ error: `设置提醒失败: ${e.message}` });
    }
  },

  list_reminders() {
    const reminders = reminderStore.getAll().filter(r => !r.done);

    if(reminders.length === 0) {
       return JSON.stringify({ reminders: [], message: "当前没有待处理的提醒" });
    }
    return JSON.stringify({ reminders });
  },
  get_cost_summary() {
    const summary = costTracker.getTodaySummary();
    return JSON.stringify(summary);
  },
  execute_shell() {
    return JSON.stringify({
      success: true,
      message: `执行成功`
    })
  },
  async web_search({ query, max_results = 3 }) {
    try {
      const client = tavily({ apiKey: process.env.TAVILY_API_KEY });

      const response = await client.search(query, {
        maxResults: Math.min(max_results, 5),
        searchDepth: "basic",
        includeAnswer: true,      // 让 Tavily 直接给一个 AI 友好的摘要答案
        includeRawContent: false  // 不要原始 HTML，节省 token
      });

      // 整理结果，只给 AI 需要的字段
      const results = {
        answer: response.answer ?? "",   // Tavily 生成的直接答案
        sources: response.results.map(r => ({
          title: r.title,
          url: r.url,
          content: r.content?.slice(0, 500) ?? "" // 每条最多 500 字
        }))
      };

      return JSON.stringify(results);
    } catch (e) {
      return JSON.stringify({ error: `搜索失败: ${e.message}` });
    }
  }
};

// ─── 统一执行入口 ─────────────────────────────────────────────
// 返回字符串格式的结果（AI 需要接收字符串）
export async function executeTool(name, args) {
  const fn = toolImplementations[name];
  if (!fn) {
    return JSON.stringify({ error: `未知工具: ${name}` });
  }

  try {
    return await fn(args);
  } catch (e) {
    return JSON.stringify({ error: `工具执行出错: ${e.message}` });
  }
}