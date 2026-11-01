# 为什么使用评审作业适配

2026-11-01 检查了 Entire 的公开网页客户端、Cell/Core OpenAPI 和登录后的
Agent 界面。没有发现经验证可直接接受聊天历史并返回通用推理的公开接口。
这是已检查范围内的结论，不代表所有内部服务均不存在模型代理。

## 已找到的能力

| 能力 | API 用途 |
| --- | --- |
| `GET /agents/models` | 查询 harness、模型及默认推理档位 |
| `POST /{forge}/{project}/agents` | 保存 Agent 配置和 instructions |
| `POST /{forge}/{project}/agents/{id}/runs` | 针对指定 Trail/Change/head 运行仓库评审 |
| `GET /{forge}/{project}/runs/{id}` | 读取作业状态、结果和用量 |

API 地址相对项目区域的 `/api/v1`；区域必须从 Core 解析，不能硬编码假设所有
项目同一区域。当前客户端只向 HTTPS 的 Entire 域名发送凭据，禁止自动跳转。

RunCreate 不提供逐请求 `messages` 或 `tools`。问题须写入 Agent instructions，
该字段最多 16,384 字符，且置于上游评审约束之后。这解释了为何答案封装可能失败，
以及为何不能声称具备原生工具循环、token 流或硬输出预算。

## 已实现路线

为每个独立文本请求创建无自动触发器的临时 Agent，在已有仓库环境中运行固定
目标的评审；轮询完成后仅接受指定 JSON 答案封装，最后归档临时 Agent。
本地 receipt 支持并发去重、恢复和清理重试。真实结果见 [联调记录](live-validation.zh-CN.md)。

公开仓库不携带下载的上游网页资源/OpenAPI 快照，也不包含登录会话；这些不是
运行依赖。调用官方 CLI 读取凭据，不使用浏览器 Cookie 或假设中的内部推理入口。

## 公开参考

- [Entire CLI 源码与 release](https://github.com/entireio/cli)
- [Entire Agents](https://docs.entire.com/guides/trails/agents)
- [CLI auth](https://docs.entire.com/cli-reference/auth)
- [Cell OpenAPI](https://aws-us-east-2.api.entire.io/api/v1/openapi.json)
- [Core OpenAPI](https://us.console.entire.io/api/v1/openapi.json)

这些在线接口及模型目录可能随上游部署变化。未来接入独立推理入口前，需验证
其 schema、认证、错误、结束事件和工具语义，不能仅据内部名称推测可用性。
