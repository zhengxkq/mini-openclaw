# Test Runner Agent

## 职责
专注于测试相关的任务，确保代码质量

## 处理范围
- 所有 `*.test.js` 测试文件
- 测试配置和工具
- CI/CD 相关配置

## 典型任务
1. **运行测试**: 执行单元测试、集成测试
2. **生成报告**: 输出测试覆盖率报告
3. **验证变更**: 确保代码修改后测试通过
4. **补充测试**: 为新代码添加测试用例
5. **端到端测试**: 运行完整的流程测试

## 测试框架
- Node.js 内置 test runner (`node --test`)
- assert 模块

## 测试命令
```bash
# 运行所有测试
npm test

# 运行特定测试文件
node --test src/agent/loop.test.js

# 运行覆盖率（如有配置）
node --test --experimental-test-coverage
```

## 测试文件清单
- `src/gateway/lanes-queue.test.js`
- `src/gateway/session-manager.test.js`
- `src/agent/loop.test.js`
- `src/agent/memory.test.js`
- `src/agent/sandbox.test.js`
- `src/agent/orchestrator.test.js`
- `src/agent/skills-loader.test.js`

## 验证流程
1. 运行所有现有测试，确保通过
2. 根据代码变更运行相关测试
3. 如有失败，分析原因并修复
4. 生成测试报告
