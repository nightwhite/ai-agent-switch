# AI Agent Switch

[English](./README.md) | [简体中文](./README_CN.md)

`ai-agent-switch` 是 AI Agent Switch 的 npm 包名。AI Agent Switch 是一个 Bun + TypeScript 编写的 AI 编程客户端配置控制平面。

它面向个人用户，提供 CLI 和默认 TUI，用来管理多个客户端的 provider / model 配置，并可选择开启本地代理、自动重试和自动切换。

## 安装

```bash
npm install -g ai-agent-switch
```

如果你只想在项目里使用，也可以直接安装为依赖：

```bash
npm install ai-agent-switch
```

安装后直接运行：

```bash
ai-agent-switch
as
```

npm 会根据当前平台自动安装对应的二进制包，不需要手动下载 release 资产。

容器镜像或精简 Linux 环境可以直接安装 GitHub Releases 里的独立二进制：

```bash
curl -fsSL https://raw.githubusercontent.com/sealos-apps/ai-agent-switch/main/install.sh | sh -s -- vX.Y.Z
```

## 设计边界

- 裸命令 `ai-agent-switch` 或别名 `as` 默认进入 TUI。
- 不提供 `init` 命令。
- 不提供 `ai-agent-switch tui` 命令。
- 第一版不做备份、回滚、统计、历史、费用、token 或成功率报表。
- 不使用 SQLite 或嵌入式数据库。
- `ai-agent-switch` 自身配置使用 JSONC。

## 常用命令

```bash
ai-agent-switch
ai-agent-switch status
ai-agent-switch status --json
ai-agent-switch doctor
ai-agent-switch doctor --json
ai-agent-switch config path
ai-agent-switch config validate
ai-agent-switch config validate --json
ai-agent-switch config schema
ai-agent-switch client list
ai-agent-switch client list --json
ai-agent-switch client detect
ai-agent-switch client detect qwen
ai-agent-switch client show qwen
ai-agent-switch client use-proxy qwen --dry-run --json
ai-agent-switch client use-proxy qwen -y
ai-agent-switch provider list
ai-agent-switch provider list --json
ai-agent-switch provider preset-list
ai-agent-switch provider preset-add openrouter --api-key-env OPENROUTER_API_KEY
ai-agent-switch provider preset-add ai-agent-switch-proxy
ai-agent-switch provider show openrouter
ai-agent-switch provider add --id openrouter --type openai-chat-compatible --base-url https://openrouter.ai/api/v1 --api-key-env OPENROUTER_API_KEY --model qwen/qwen3-coder --default-model qwen/qwen3-coder
ai-agent-switch provider init --id aiproxy --name AIProxy --base-url https://aiproxy.usw-1.sealos.io/v1 --api-key-env AIPROXY_API_KEY --model gpt-5.4-mini:codex_responses --default-model gpt-5.4-mini
ai-agent-switch provider model-add openrouter anthropic/claude-sonnet-4.5
ai-agent-switch provider model-remove openrouter qwen/qwen3-coder
ai-agent-switch provider default-model openrouter anthropic/claude-sonnet-4.5
ai-agent-switch provider test openrouter
ai-agent-switch model list
ai-agent-switch model list --json
ai-agent-switch switch --client openclaw --provider aiproxy -y
ai-agent-switch switch --client hermes --provider aiproxy --model gpt-5.4-mini --dry-run --json
ai-agent-switch route set-default openrouter/qwen/qwen3-coder
ai-agent-switch route add-fallback openrouter/anthropic/claude-sonnet-4.5
ai-agent-switch route list
ai-agent-switch route list --json
ai-agent-switch proxy enable
ai-agent-switch proxy set --port 17890 --upstream-proxy http://127.0.0.1:7890 --retry true --max-attempts 3 --failover true
ai-agent-switch proxy start
ai-agent-switch proxy start --daemon
ai-agent-switch proxy status
```

## TUI 快捷键

裸命令会进入 TUI：

```bash
ai-agent-switch
as
```

快捷键：

- `↑` / `↓`：移动选择。
- `Enter`：进入菜单或执行当前操作。
- `Esc`：返回上一级。
- `h`：打开帮助。
- `q`：退出。

TUI 首页是主菜单：

```text
Clients
Providers
Models
```

常用流程：

1. 进入 `Providers`，选择 `Add from preset` 或 `Add custom provider` 添加 provider。
2. 进入 `Models`，用 `r` / `f` 配置 ai-agent-switch proxy 背后的 primary/fallback route。
3. 进入 `Clients`，选择某个 client 后进入详情页，再选择继续使用当前配置或接入 ai-agent-switch proxy。

子菜单常用操作：

- `Clients`：`Enter` 进入 client 详情；详情页中可选择 `Use current config` 或 `Use ai-agent-switch proxy`。
- `Providers`：`a` 添加 preset，`e` 编辑 provider，`x` 删除 provider，`t` 测试 provider。
- `Models`：`a` 添加模型，`x` 删除模型，`*` 设置默认模型，`r` 设置 route primary，`f` 添加 fallback。

非交互终端中，裸命令会退化为只读状态输出。

## 自动化 / 脚本输出

以下命令支持 JSON 输出：

```bash
ai-agent-switch status --json
ai-agent-switch doctor --json
ai-agent-switch config validate --json
ai-agent-switch client list --json
ai-agent-switch client detect --json
ai-agent-switch client detect qwen --json
ai-agent-switch client use-proxy qwen --dry-run --json
ai-agent-switch provider list --json
ai-agent-switch model list --json
ai-agent-switch switch --client openclaw --provider aiproxy --dry-run --json
ai-agent-switch route list --json
ai-agent-switch proxy status --json
ai-agent-switch use qwen openrouter/qwen/qwen3-coder --dry-run --json
ai-agent-switch use-all openrouter/qwen/qwen3-coder --dry-run --json
```

导出配置 schema：

```bash
ai-agent-switch config schema
```

Shell completion：

```bash
ai-agent-switch completion zsh > ~/.zsh/completions/_ai-agent-switch
ai-agent-switch completion bash > ~/.local/share/bash-completion/completions/ai-agent-switch
```

## Provider 示例

查看内置 preset：

```bash
ai-agent-switch provider preset-list
ai-agent-switch provider preset-show openrouter
```

一键添加 OpenRouter：

```bash
ai-agent-switch provider preset-add openrouter --api-key-env OPENROUTER_API_KEY
```

把本地 `ai-agent-switch proxy` 暴露成一个 OpenAI-compatible provider：

```bash
ai-agent-switch provider preset-add ai-agent-switch-proxy
```

OpenRouter：

```bash
ai-agent-switch provider add \
  --id openrouter \
  --name OpenRouter \
  --type openai-chat-compatible \
  --base-url https://openrouter.ai/api/v1 \
  --api-key-env OPENROUTER_API_KEY \
  --model qwen/qwen3-coder \
  --default-model qwen/qwen3-coder
```

Provider type 里 OpenAI 相关的两条线要分开：

- `openai-responses`：OpenAI Responses API，例如官方 OpenAI API。
- `openai-chat-compatible`：OpenAI Chat Completions 兼容 endpoint，例如 OpenRouter、DeepSeek compatible mode、本地代理等。

旧配置里的 `openai` 和 `openai-compatible` 仍然会被接受，分别按 `openai-responses` 和 `openai-chat-compatible` 处理。

初始化统一 AIProxy provider：

```bash
ai-agent-switch provider init \
  --id aiproxy \
  --name AIProxy \
  --base-url https://aiproxy.usw-1.sealos.io/v1 \
  --api-key-env AIPROXY_API_KEY \
  --model glm-5.1:chat_completions \
  --model deepseek-v4-flash:chat_completions \
  --model gpt-5.4-mini:codex_responses \
  --model gpt-5.5:codex_responses \
  --model claude-sonnet-4-6:anthropic_messages \
  --model claude-opus-4-7:anthropic_messages \
  --default-model gpt-5.4-mini
```

`provider init` 会把 AIProxy 保持为一个 provider，并记录每个模型自己的请求 API 模式。每个 `--model` 都必须写成 `modelId:apiMode`；目前支持 `chat_completions`、`codex_responses` 和 `anthropic_messages`。

内置 preset 包括：

- `openrouter`
- `deepseek`
- `dashscope`
- `moonshot`
- `siliconflow`
- `openai`
- `anthropic`
- `gemini`
- `ollama`
- `lmstudio`
- `ai-agent-switch-proxy`

本地 Ollama：

```bash
ai-agent-switch provider add \
  --id ollama \
  --name Ollama \
  --type ollama \
  --base-url http://127.0.0.1:11434/v1 \
  --model llama3.1
```

模型增删：

```bash
ai-agent-switch provider model-add openrouter anthropic/claude-sonnet-4.5
ai-agent-switch provider model-remove openrouter qwen/qwen3-coder
ai-agent-switch provider default-model openrouter anthropic/claude-sonnet-4.5
```

查看所有可用于 `use`、`use-all` 和 `route` 的模型目标：

```bash
ai-agent-switch model list
ai-agent-switch model list --json
```

## 客户端配置

不重启 client 进程，直接切换某个 client 使用的 provider/model：

```bash
ai-agent-switch switch --client openclaw --provider aiproxy -y
ai-agent-switch switch --client hermes --provider aiproxy --model glm-5.1 -y
ai-agent-switch switch --client openclaw --provider aiproxy --dry-run --json
```

省略 `--model` 时，`switch` 会使用 provider 的 `defaultModel`。如果 provider 没有默认模型，命令会失败，并要求显式传入 `--model`。

为某个 client 配置一个或多个具名模型槽位：

```bash
ai-agent-switch client configure --client cowagent --slot main=aiproxy/glm-5.1 -y --json
```

`client configure` 会以原子方式应用目标 client 请求的具名模型槽位配置。`main` 槽位是默认运行模型；其他槽位是 client-specific 的，只有在对应 client adapter 明确支持并消费时，才会影响运行时行为。

查看 ai-agent-switch 支持配置的 client 列表，不读取各 client 当前配置：

```bash
ai-agent-switch client list
ai-agent-switch client list --json
```

进入某个 client 的当前配置读取：

```bash
ai-agent-switch client show qwen
ai-agent-switch client detect qwen
```

让某个 client 接入本地 ai-agent-switch proxy：

```bash
ai-agent-switch client use-proxy qwen --dry-run --json
ai-agent-switch client use-proxy qwen -y
```

接入 proxy 后，client 自身只连接 `http://127.0.0.1:17890/v1` 并使用 `ai-agent-switch/default`；真实 provider/model 由 `route` 决定。

## 代理路由

代理路由用于控制 `ai-agent-switch proxy` 默认使用哪个 provider/model，以及失败后切到哪里。

```bash
ai-agent-switch route set-default openrouter/qwen/qwen3-coder
ai-agent-switch route add-fallback openrouter/anthropic/claude-sonnet-4.5
ai-agent-switch route list
```

当代理收到 OpenAI-compatible JSON 请求时，会把请求体里的 `model` 改写为当前路由候选的 model。主候选失败后，会按 fallback 顺序切换 provider/model。

删除 provider 或删除 provider 下的模型时，相关 route candidate 会自动移除，避免配置留下不可用引用。

## 高级：直接写客户端原生配置

推荐路径是 `client use-proxy`：client 只连 ai-agent-switch proxy，真实 provider/model 由 route 管。下面的 `use` / `use-all` 是高级路径，会把 provider/model 直接写进 client 原生配置。

直接切换单个客户端：

```bash
ai-agent-switch use qwen openrouter/qwen/qwen3-coder -y
```

直接预演所有支持的客户端：

```bash
ai-agent-switch use-all openrouter/qwen/qwen3-coder --dry-run --json
```

直接应用到所有支持的客户端：

```bash
ai-agent-switch use-all openrouter/qwen/qwen3-coder -y
```

## 代理

`ai-agent-switch` 自身代理默认监听 `127.0.0.1:17890`。上游网络代理默认使用 `http://127.0.0.1:7890`，适合 Clash / Mihomo / Surge 这类本地代理。

```bash
ai-agent-switch proxy enable
ai-agent-switch proxy set --upstream-proxy http://127.0.0.1:7890
ai-agent-switch proxy start
```

健康检查：

```bash
curl http://127.0.0.1:17890/health
```

模型列表：

```bash
curl http://127.0.0.1:17890/v1/models
```

给其他 OpenAI-compatible 客户端使用时，可配置：

```text
baseUrl: http://127.0.0.1:17890/v1
model: openrouter/qwen/qwen3-coder
```

如果配置了默认 route/fallback 链，`/v1/models` 返回 route candidates；否则返回所有已配置 provider 的模型，模型 ID 统一为 `<provider>/<model>`。

OpenAI-compatible 请求体里的 `model` 如果是合法的 `<provider>/<model>`，代理会优先路由到该 provider/model，并把转发给上游的 `model` 改写为真实模型 ID。没有传合法模型时，继续使用默认 route/fallback 链。

后台启动：

```bash
ai-agent-switch proxy start --daemon
ai-agent-switch proxy status
ai-agent-switch proxy status --json
ai-agent-switch proxy stop
```

`proxy start` 会尊重 `proxy.enabled`。如果还没有启用代理，会提示先执行 `ai-agent-switch proxy enable`。也可以用一条命令启用并启动：

```bash
ai-agent-switch proxy start --force
```

代理第一版支持：

- OpenAI-compatible 请求转发。
- 流式响应透传。
- `/health` 健康检查。
- `/v1/models` OpenAI-compatible 模型列表。
- Bun fetch 的上游 `proxy` 选项。
- 自动重试。
- 有序 provider failover。
- 不记录请求历史和统计。

## 本地开发

```bash
bun install
bun test
bun run build
```

## 本地运行 / 打包

开发时可以直接运行构建产物：

```bash
bun dist/ai-agent-switch.js status
```

`bin/` 里的 npm 命令包装器会解析匹配当前平台的 `ai-agent-switch-<platform>` optional dependency，所以本地开发建议直接运行构建产物。需要测试已发布的全局命令时，请使用 `npm install -g ai-agent-switch`。

打包检查：

```bash
npm pack --dry-run
```

根包只包含 `bin/`、`README.md`、`README_CN.md` 和 `package.json`。

## npm 分发

AI Agent Switch 通过 npm 分发。发布 workflow 会先发布各平台包，再发布带有匹配 optional dependencies 的根包 `ai-agent-switch`。
