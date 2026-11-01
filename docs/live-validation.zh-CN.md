# 联调记录

日期：2026-11-01。Windows，Node.js v24.11.1，官方 Entire CLI v0.12.2。
官方 CLI 通过设备码登录，未导出浏览器 Cookie。公开仓库不分发账号、项目配置、
具体作业标识、日志或本地证据文件；每个用户需完成自己的设置。

## 已验证

- Entire Codex 评审作业按短文本答案契约返回 `ENTIRE2API_OK`。
- 三种 HTTP 接口共享相同归一化请求和幂等记录。
- OpenAI Python SDK 3.42.0 的 Chat/Responses 普通响应、SSE 累积器正常。
- Anthropic Python SDK 2.3.0 的 Messages 普通响应、SSE 累积器正常，使用 Codex 上游。
- 官方 MCP Server/Client SDK 2.4.0 的 stdio 连接、工具发现、参数校验、文本结果正常。
- Claude Code local 配置连接正常；MCP 真实调用复用了同一个已验证的上游作业。
- 本地自动化测试覆盖请求/响应、SSE、幂等、丢失 admission 回复恢复、取消、归档、
  输入大小、凭据目的地、MCP stdio、跨目录 CLI 配置和安装参数。

## 限制

短小连通性提示通过不代表任意长对话、任意任务或所有模型都会遵守答案封装。
Claude 上游曾完成评审，但没有按约定返回聊天答案，网关正确返回 502；因此默认
只开放 `entire-codex`。支持 Anthropic 协议与使用 Claude 上游是两件事。

未验证所有第三方 Agent 客户端、主模型的自动工具选择、macOS 真机、Windows ARM
或 Docker 构建/运行。持续集成只运行无需账号的自动化测试，不运行付费 Entire 作业。

SSE 为作业完成后的缓冲输出；usage 属于整个评审作业。客户端工具、文件、图片、
原生 token 流和硬 token 预算没有实现。
