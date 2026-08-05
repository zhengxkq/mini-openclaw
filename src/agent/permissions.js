// src/agent/permissions.js

// 权限级别定义
export const Permission = {
  READ_FILE: "read_file",         // 读本地文件
  WRITE_FILE: "write_file",       // 写本地文件
  EXECUTE_SHELL: "execute_shell", // 执行 shell 命令
  NETWORK: "network",             // 网络请求
  REMINDER: "reminder",           // 设置提醒
  CALCULATE: "calculate",         // 数学计算
};

// 每个工具需要哪些权限
export const toolPermissions = {
  get_weather:    [Permission.NETWORK],
  read_file:      [Permission.READ_FILE],
  write_file:     [Permission.WRITE_FILE],
  calculate:      [Permission.CALCULATE],
  set_reminder:   [Permission.REMINDER],
  list_reminders: [Permission.REMINDER],
  get_cost_summary: [],  // 不需要特殊权限
  web_search: [Permission.NETWORK],
  add_behavior_rule:    [], 
  remove_behavior_rule: [],
  list_behavior_rules:  [],
};

// 默认允许的权限（安全的操作）
export const defaultAllowedPermissions = new Set([
  Permission.CALCULATE,
  Permission.REMINDER,
  Permission.READ_FILE,
//   Permission.WRITE_FILE,
  Permission.NETWORK,
]);

// 需要 HITL 审批的权限（不可逆操作）
export const hitlPermissions = new Set([
  Permission.WRITE_FILE,
  Permission.EXECUTE_SHELL,
]);