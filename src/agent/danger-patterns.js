// src/agent/danger-patterns.js
// 已知危险命令的黑名单，无论什么情况都不执行

export const dangerPatterns = [
  // 文件系统破坏
  { pattern: /rm\s+-rf\s+[\/~]/, desc: "递归删除根目录或家目录" },
  { pattern: /rmdir\s+\//, desc: "删除根目录" },
  { pattern: /mkfs\./, desc: "格式化磁盘" },
  { pattern: /dd\s+if=.*of=\/dev\//, desc: "写入磁盘设备" },

  // 权限提升
  { pattern: /sudo\s+/, desc: "sudo 提权" },
  { pattern: /chmod\s+777\s+\//, desc: "修改根目录权限" },
  { pattern: /chown\s+.*\//, desc: "修改根目录所有者" },

  // 网络攻击
  { pattern: /curl.*\|\s*bash/, desc: "curl pipe bash（远程代码执行）" },
  { pattern: /wget.*\|\s*bash/, desc: "wget pipe bash（远程代码执行）" },
  { pattern: /nc\s+-l/, desc: "netcat 监听（反向shell）" },

  // 数据外泄
  { pattern: /curl.*(-d|--data).*password/i, desc: "发送密码数据" },
  { pattern: /cat\s+.*\.env/, desc: "读取 .env 文件" },
  { pattern: /cat\s+.*id_rsa/, desc: "读取 SSH 私钥" },
];

// 检查命令是否匹配危险模式
// 返回匹配到的危险描述，没有危险返回 null
export function checkDangerPatterns(command) {
  for (const { pattern, desc } of dangerPatterns) {
    if (pattern.test(command)) {
      return desc;
    }
  }
  return null;
}