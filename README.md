# AI Agent Switch

[English](./README.md) | [Chinese](./README_CN.md)

`ai-agent-switch` is the npm package for AI Agent Switch, a Bun + TypeScript CLI/TUI control plane for managing AI coding agent providers, models, local proxy routing, retries, and failover.

It is designed for developers who use multiple AI coding clients such as Codex, Gemini CLI, Qwen Code, OpenClaw, Hermes, Crush, OpenCode, CowAgent, and Claude Code, and want one place to manage provider/model configuration.

## Installation

```bash
npm install -g ai-agent-switch
```

You can also install it as a project dependency:

```bash
npm install ai-agent-switch
```

Run either command after installation:

```bash
ai-agent-switch
as
```

npm installs the matching platform package automatically through optional dependencies. You do not need to download release assets manually.

For container images or minimal Linux environments, install the standalone binary from GitHub Releases:

```bash
curl -fsSL https://raw.githubusercontent.com/sealos-apps/ai-agent-switch/main/install.sh | sh -s -- vX.Y.Z
```

## Scope

- Bare `ai-agent-switch` or `as` opens the TUI by default.
- There is no `init` command.
- There is no `ai-agent-switch tui` command.
- The first version does not implement backup, rollback, usage history, cost reports, token reports, or success-rate reports.
- It does not use SQLite or any embedded database.
- AI Agent Switch stores its own configuration as JSONC.

## Common Commands

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

## TUI

Bare commands open the TUI:

```bash
ai-agent-switch
as
```

Keyboard shortcuts:

- `↑` / `↓`: Move selection.
- `Enter`: Open the selected menu or run the selected action.
- `Esc`: Go back.
- `h`: Open help.
- `q`: Quit.

The TUI starts with three main sections:

```text
Clients
Providers
Models
```

Common flow:

1. Open `Providers`, then add a built-in preset or custom provider.
2. Open `Models`, then use `r` / `f` to configure the primary/fallback route behind the AI Agent Switch proxy.
3. Open `Clients`, choose a client, then either keep the current native config or connect that client to the AI Agent Switch proxy.

Submenu actions:

- `Clients`: `Enter` opens client details; the detail screen can apply the current model or use the proxy.
- `Providers`: `a` adds a preset, `e` edits a provider, `x` removes a provider, and `t` tests connectivity.
- `Models`: `a` adds a model, `x` removes a model, `*` sets provider default, `r` sets route primary, and `f` adds fallback.

In non-interactive terminals, the bare command prints a read-only status summary instead of opening the TUI.

## Automation and JSON Output

These commands support JSON output:

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

Export the configuration schema:

```bash
ai-agent-switch config schema
```

Shell completion:

```bash
ai-agent-switch completion zsh > ~/.zsh/completions/_ai-agent-switch
ai-agent-switch completion bash > ~/.local/share/bash-completion/completions/ai-agent-switch
```

## Providers

List built-in presets:

```bash
ai-agent-switch provider preset-list
ai-agent-switch provider preset-show openrouter
```

Add OpenRouter from a preset:

```bash
ai-agent-switch provider preset-add openrouter --api-key-env OPENROUTER_API_KEY
```

Expose the local AI Agent Switch proxy as an OpenAI-compatible provider:

```bash
ai-agent-switch provider preset-add ai-agent-switch-proxy
```

Add OpenRouter manually:

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

OpenAI-related provider types are intentionally separate:

- `openai-responses`: OpenAI Responses API, for example the official OpenAI API.
- `openai-chat-compatible`: OpenAI Chat Completions-compatible endpoints, for example OpenRouter, DeepSeek compatible mode, and local proxies.

Legacy `openai` and `openai-compatible` values are still accepted and normalized to `openai-responses` and `openai-chat-compatible`.

Initialize a unified AIProxy provider:

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

`provider init` keeps AIProxy as one provider and stores each model's request API mode. Every `--model` must use `modelId:apiMode`; accepted API modes are `chat_completions`, `codex_responses`, and `anthropic_messages`.

Built-in presets:

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

Add local Ollama:

```bash
ai-agent-switch provider add \
  --id ollama \
  --name Ollama \
  --type ollama \
  --base-url http://127.0.0.1:11434/v1 \
  --model llama3.1
```

Manage provider models:

```bash
ai-agent-switch provider model-add openrouter anthropic/claude-sonnet-4.5
ai-agent-switch provider model-remove openrouter qwen/qwen3-coder
ai-agent-switch provider default-model openrouter anthropic/claude-sonnet-4.5
```

List model targets for `use`, `use-all`, and `route`:

```bash
ai-agent-switch model list
ai-agent-switch model list --json
```

## Client Configuration

Switch one client to a provider/model without restarting the client process:

```bash
ai-agent-switch switch --client openclaw --provider aiproxy -y
ai-agent-switch switch --client hermes --provider aiproxy --model glm-5.1 -y
ai-agent-switch switch --client openclaw --provider aiproxy --dry-run --json
```

When `--model` is omitted, `switch` uses the provider `defaultModel`. If no default model is configured, the command fails and asks for an explicit `--model`.

Configure one or more named model slots for a client:

```bash
ai-agent-switch client configure --client cowagent --slot main=aiproxy/glm-5.1 -y --json
```

`client configure` atomically applies the requested named model slot configuration for the target client. The `main` slot is the default runtime model. Additional slots are client-specific and only affect runtime behavior when the client's adapter explicitly supports and consumes them.

List supported clients without reading each current client config:

```bash
ai-agent-switch client list
ai-agent-switch client list --json
```

Inspect a specific client:

```bash
ai-agent-switch client show qwen
ai-agent-switch client detect qwen
```

Connect a client to the local AI Agent Switch proxy:

```bash
ai-agent-switch client use-proxy qwen --dry-run --json
ai-agent-switch client use-proxy qwen -y
```

After proxy connection, the client points to `http://127.0.0.1:17890/v1` and uses `ai-agent-switch/default`. The actual provider/model is controlled by `route`.

## Proxy Routes

Proxy routes control the default provider/model used by the AI Agent Switch proxy and the ordered fallback chain.

```bash
ai-agent-switch route set-default openrouter/qwen/qwen3-coder
ai-agent-switch route add-fallback openrouter/anthropic/claude-sonnet-4.5
ai-agent-switch route list
```

When the proxy receives an OpenAI-compatible JSON request, it rewrites the request body `model` to the selected upstream model. If the primary route fails, it switches to fallback candidates in order.

Removing a provider or provider model also removes related route candidates, so the route configuration does not keep broken references.

## Advanced Native Client Writes

The recommended path is `client use-proxy`: clients connect only to the AI Agent Switch proxy, and routes control the real provider/model. The `use` and `use-all` commands are advanced paths that write provider/model values directly into native client config files.

Switch one client directly:

```bash
ai-agent-switch use qwen openrouter/qwen/qwen3-coder -y
```

Preview all supported clients:

```bash
ai-agent-switch use-all openrouter/qwen/qwen3-coder --dry-run --json
```

Apply to all supported clients:

```bash
ai-agent-switch use-all openrouter/qwen/qwen3-coder -y
```

## Proxy

The AI Agent Switch proxy listens on `127.0.0.1:17890` by default. The default upstream network proxy is `http://127.0.0.1:7890`, which works well with local proxy tools such as Clash, Mihomo, or Surge.

```bash
ai-agent-switch proxy enable
ai-agent-switch proxy set --upstream-proxy http://127.0.0.1:7890
ai-agent-switch proxy start
```

Health check:

```bash
curl http://127.0.0.1:17890/health
```

Model list:

```bash
curl http://127.0.0.1:17890/v1/models
```

Use this configuration from other OpenAI-compatible clients:

```text
baseUrl: http://127.0.0.1:17890/v1
model: openrouter/qwen/qwen3-coder
```

If a default route/fallback chain is configured, `/v1/models` returns route candidates. Otherwise it returns all configured provider models as `<provider>/<model>`.

If an OpenAI-compatible request body contains a valid `<provider>/<model>` value, the proxy routes to that provider/model and rewrites the upstream `model` to the real model ID. Otherwise it uses the default route/fallback chain.

Daemon mode:

```bash
ai-agent-switch proxy start --daemon
ai-agent-switch proxy status
ai-agent-switch proxy status --json
ai-agent-switch proxy stop
```

`proxy start` respects `proxy.enabled`. If the proxy is not enabled yet, run:

```bash
ai-agent-switch proxy enable
```

To enable the proxy and start it in one command:

```bash
ai-agent-switch proxy start --force
```

The first proxy version supports:

- OpenAI-compatible request forwarding.
- Streaming response passthrough.
- `/health` health checks.
- `/v1/models` OpenAI-compatible model lists.
- Bun fetch upstream `proxy` option.
- Automatic retries.
- Ordered provider failover.
- No request history or analytics storage.

## Local Development

```bash
bun install
bun test
bun run build
```

## Local Run and Packaging

Run the built artifact directly:

```bash
bun dist/ai-agent-switch.js status
```

The npm command wrappers in `bin/` resolve the matching `ai-agent-switch-<platform>` optional dependency, so local development should run the built artifact directly. Use `npm install -g ai-agent-switch` to test the published global commands.

Package dry-run:

```bash
npm pack --dry-run
```

The published root package contains only `bin/`, `README.md`, `README_CN.md`, and `package.json`.

## npm Distribution

AI Agent Switch is distributed through npm. The release workflow publishes platform packages first, then publishes the root `ai-agent-switch` package with matching optional dependencies.
