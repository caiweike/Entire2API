# Entire2API

[![Tests](https://github.com/caiweike/Entire2API/actions/workflows/ci.yml/badge.svg)](https://github.com/caiweike/Entire2API/actions/workflows/ci.yml)

通过 Entire 仓库评审作业提供 **OpenAI / Anthropic 格式的文本接口**，以及供 AI Agent 调用的本地 MCP 工具 `entire_ask`。

这是非官方的评审作业适配器。每次新问题都会运行 Entire 评审并消耗你的额度，通常需要等待数十秒到几分钟。它适合短文本问答、分析和第二意见；主 Agent 继续负责文件操作、命令执行和工具循环。

**English:** An unofficial Entire review-job text adapter with OpenAI-compatible and Anthropic-compatible HTTP subsets and a local stdio MCP tool. Bring your own Entire account and working review environment. This is not a full inference API or a hosted/free model service. See [Agent-assisted installation](INSTALL.md).

## 让你的 Agent 安装

将下面这段发给支持本地工具和 MCP 的 Agent：

> 请帮我安装 https://github.com/caiweike/Entire2API 。先阅读仓库的 INSTALL.md，检查环境并安装，再把 entire_ask 接入我使用的 Agent 客户端。Entire 登录由我本人完成；项目和已有评审 run ID 由我提供。保留现有 MCP 配置、主模型与权限设置，完成后检查连接，并说明是否实际运行过付费作业。

安装需要 **Node.js 24+、Git、官方 Entire CLI、你自己的 Entire 账号，以及可运行自定义评审 Agent 的专用仓库和已有有效作业**。仓库不包含账号、令牌或共享额度。首次没有可用评审环境时，需要先在 Entire 中准备好该环境。

## 手动快速开始

```sh
git clone https://github.com/caiweike/Entire2API.git
cd Entire2API
npm ci --ignore-scripts
npm test
```

Windows PowerShell 如遇脚本策略限制，请用 `npm.cmd`。Windows x64 可运行 `scripts/install-cli.ps1` 安装并校验固定版本官方 CLI；其他平台从 [Entire CLI releases](https://github.com/entireio/cli/releases/tag/v0.12.2) 安装对应版本。

```sh
# 完成设备登录，无需把密码或 token 发送给 Agent。
node bin/entire2api.mjs login

# 用你自己的值替换两个占位符；读取已有作业，不启动新作业。
node --use-env-proxy bin/entire2api.mjs configure et/PROJECT RUN_ID

# 保持这个终端运行。
node --use-env-proxy bin/entire2api.mjs start
```

另开终端，为 Claude Code 注册（以下为同一 OS 用户的所有项目）：

```sh
node bin/entire2api.mjs register --scope user
node bin/entire2api.mjs doctor
```

重启 Claude Code，用 `/mcp` 查看 `entire2api`。首次可直接问：

> 用 entire_ask 解释幂等性，给一个简短示例。

单项目注册使用 `register --scope local --project-dir /absolute/project`；Windows 路径需替换为实际目录。注册不覆盖同名服务，也不自动授予工具权限。

## 其他 Agent 客户端

支持 **本地 stdio MCP** 的客户端均可尝试接入；目前已实测官方 MCP 客户端与 Claude Code，未逐一验证所有客户端。

```sh
node bin/entire2api.mjs mcp-config
```

命令输出带实际 Node/安装绝对路径的 `mcpServers` JSON。把 `entire2api` 条目合并进客户端配置，工具超时设为至少 300 秒。密钥由本地文件读取，配置中无需填写。客户端若不识别 `type` 或 `timeout`，使用其原生设置。直接启动生成的 Node 命令，避免 npm 横幅污染 stdio。

想省去每次点名工具，可把 [自动委派偏好](examples/agent-instructions.md) 合并进该客户端的项目规则或系统提示。它引导主模型自动调用，不是强制模型路由，也不授予权限。Claude Code 的完整工具名为 `mcp__entire2api__entire_ask`。

MCP 只发送显式短问题，不自动转发会话、系统提示或工具定义。网关必须持续运行。云端 Agent 无法直接运行本地路径，当前未提供远程 HTTP MCP 服务。

### 工具参数

| 参数 | 说明 |
| --- | --- |
| `question` | 必填，独立短文本，最多 12,000 个 JavaScript 字符；编码后的上游 instructions 仍受 16,384 字符限制 |
| `max_tokens` | 可选，1–2048，默认 512，仅为上游建议预算 |
| `request_id` | 可选，1–100 个可见 ASCII 字符；相同问题、模型与预算重试时复用 |

结果包含文本，以及结构化 `answer`、`model`、`run_id`、`request_id`。等待时发送 MCP 进度通知；取消/超时会断开 HTTP 请求，由网关尝试取消上游作业。

## HTTP 接口

默认监听 `127.0.0.1:8080`，Key 在本机 `.local/gateway-key.txt`。不要把该文件发到聊天或提交到 Git。

| 接口 | 支持范围 |
| --- | --- |
| `POST /v1/chat/completions` | 单候选文本、多轮消息、普通响应和 SSE |
| `POST /v1/messages` | 文本及顶层 system、普通响应和 SSE |
| `POST /v1/responses` | 无状态文本子集、instructions、普通响应和 SSE |
| `GET /v1/models` | 本地模型别名列表，需网关认证 |
| `GET /healthz` | 进程存活检查，不代表账号、额度或上游可用 |

OpenAI 客户端的 base URL 为 `http://127.0.0.1:8080/v1`，Anthropic 客户端为 `http://127.0.0.1:8080`；API Key 均为本地网关 Key。默认模型别名为 `entire-codex`，映射 Entire 的 Codex 默认模型；上游型号可能随 Entire 更新。要固定型号，可编辑 `.local/config.json` 中对应映射的 `model` 和可选 `reasoning_effort`，之后重启网关。

```json
{
  "entire-codex": {
    "harness": "codex",
    "model": null
  }
}
```

上例是配置中的 `models` 对象内容，`null` 表示跟随 Entire 默认。新增模型须验证答案封装；支持 Anthropic 协议不表示 Claude 上游已验证可用。

### 明确限制

- 图片、文件、音频、客户端 tools、采样控制和 stop 不支持，明确返回错误。
- 不可作为 Claude Code 等客户端的完整主模型；Agent 应经 MCP 委派短文本。
- 原始 HTTP body 最多 128 KiB，上游 instructions 最多 16,384 字符（包含封装）。
- SSE 等待时只有注释心跳；作业完成后一次发送完整文本，不是原生 token 流。
- 输出 token 预算是提示词建议，无法硬性约束；usage 统计整个评审作业开销。
- Responses 不支持 `previous_response_id`、有状态会话、后台任务、结果查询或服务端工具。
- 回答依赖评审 Agent 遵守 JSON 封装约定，不能保证所有问题和模型成功；无效封装返回 502。

## 认证、数据与运行

网关认证优先使用 `ENTIRE_TOKEN` → `ENTIRE_TOKEN_FILE` → 官方 CLI。长期使用建议官方 CLI，凭据由其刷新，默认登录目录为本项目 `.local/entire`。Windows/macOS 使用 CLI 的系统凭据存储；无 keyring 的 Linux 环境按官方 CLI 支持设置 `ENTIRE_TOKEN_STORE=file` 并保护本地目录。

`.env.example` 列出网关环境变量。MCP 环境变量为 `ENTIRE2API_URL`（仅限回环根 URL）、`ENTIRE2API_KEY_FILE`、`ENTIRE2API_MODEL`；须在客户端 MCP 环境中设置，MCP 不加载通用 `.env`。更改网关端口或 Key 路径时同步配置 MCP。

每个逻辑请求创建仅手动触发、无自动事件的独立 Agent，运行已有环境、固定 Trail/Change/head，结束后归档。固定提交变化可能引发 409，需要明确更新目标。默认并发 2、每分钟最多 60 次生成请求。`Idempotency-Key` 及本地 receipt 防止相同请求的并发/重启重试重复计费；参数变化须使用新键。

**问题会写入 Entire Agent instructions 和历史，相关仓库读者可能看到。请使用合适的专用仓库，不发送机密。** `.local/state/receipts` 持久保存答案、作业 ID 和去重/清理状态，不保存输入对话或上游令牌。清理失败会留待恢复，不能保证立即取消或归档；删除 receipt 会丢失跨重启去重能力。不要让多个网关实例共用状态目录。

`.local`、`.tools`、`.env`、日志、HAR、依赖及研究快照不会进入版本管理或分发包。`npm ci` 安装依赖时使用锁文件，仓库没有自动登录、安装 CLI 或提交作业的 npm lifecycle 脚本。

## 排错

- **Connected 但工具被阻止**：MCP 连接成功与工具执行授权不同。Claude Code 的 `/permissions` 可审批具体工具；auto classifier 没有 verdict 时不要反复重试。可恢复到 Manual 模式后逐次确认：`claude --continue --permission-mode manual`。
- **“Request too large (max 32MB)”**：常见原因是将本适配器设为 Claude Code 主供应商。其完整系统提示/工具列表超出适配范围；应将主模型恢复为可用供应商，通过 MCP 调用本工具。
- **401**：检查本地 Key 路径及客户端使用的 Key，不是把 Entire token 填入网关 Key。
- **上游登录或额度错误**：在同一 `.local/entire` 目录重新完成官方 CLI 登录，检查项目权限及 Entire 账单。
- **移动安装目录**：重新生成 `mcp-config` 并更新注册，不要保留旧绝对路径。

## 验证与 Docker

`npm test` 运行无需账号和费用的网关、MCP、安装测试。GitHub Actions 在 Windows/Linux 的 Node 24 环境运行测试。

```sh
# 真实 MCP 检查：默认启动一个付费评审作业。
npm run mcp:smoke

# 真实 HTTP 检查。
npm run smoke -- chat entire-codex
```

相同输入可设置 `SMOKE_IDEMPOTENCY_KEY` 复用已有 receipt。可选官方 Python SDK 检查见 `scripts/sdk_smoke.py` 和 `requirements-test.txt`。已验证行为及限制见 [联调记录](docs/live-validation.zh-CN.md)。

Dockerfile/Compose 仅运行 HTTP 网关；当前维护者机器未验证 Docker 构建/运行。配置和 Key 准备好后，按下列方式为容器单独登录；不要将宿主机 refresh token 复制进容器：

```sh
docker compose build
docker compose run --rm --no-deps entire2api entire login --device
docker compose up -d
```

镜像校验官方 CLI v0.12.2，Compose 只发布宿主机回环端口，登录采用持久卷中的 file token store。使用前确保端口未被宿主机网关占用。

## 资料与许可

- [安装指南（面向人及 Agent）](INSTALL.md)
- [上游路线核验](docs/upstream-audit.zh-CN.md)
- [Claude Code MCP 文档](https://code.claude.com/docs/en/mcp)
- [Entire CLI](https://github.com/entireio/cli)

MIT License。与 Entire、OpenAI、Anthropic 无官方隶属关系。
