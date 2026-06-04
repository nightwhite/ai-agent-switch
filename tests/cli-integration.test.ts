import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const cliPath = join(import.meta.dir, "..", "src", "cli", "main.ts");

describe("CLI integration", () => {
  test("provider model add/remove work through CLI without client switch config", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-"));
    try {
      await run(home, "provider", "add", "--id", "openrouter", "--name", "OpenRouter", "--type", "openai-compatible", "--base-url", "https://openrouter.ai/api/v1", "--model", "a");
      await run(home, "provider", "model-add", "openrouter", "b");
      await run(home, "provider", "model-remove", "openrouter", "a");

      const config = JSON.parse(stripJsonc(await readFile(join(home, ".ai-agent-switch/config.jsonc"), "utf8")));
      expect(config.providers.openrouter.models.map((model: { id: string }) => model.id)).toEqual(["b"]);
      expect(config.clients).toEqual({});
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("provider default model can be configured through CLI", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-default-model-"));
    try {
      await run(home, "provider", "add", "--id", "openrouter", "--name", "OpenRouter", "--type", "openai-compatible", "--base-url", "https://openrouter.ai/api/v1", "--model", "a", "--model", "b", "--default-model", "a");
      await run(home, "provider", "default-model", "openrouter", "b");

      const config = JSON.parse(stripJsonc(await readFile(join(home, ".ai-agent-switch/config.jsonc"), "utf8")));
      expect(config.providers.openrouter.defaultModel).toBe("b");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("provider init stores model api mode and kind metadata", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-provider-init-kind-"));
    try {
      const output = await run(
        home,
        "provider",
        "init",
        "--id",
        "aiproxy",
        "--name",
        "AIProxy",
        "--base-url",
        "https://aiproxy.usw-1.sealos.io/v1",
        "--api-key-env",
        "AIPROXY_API_KEY",
        "--model",
        "glm-5.1:chat_completions:llm",
        "--model",
        "qwen-image-2.0-pro:image_generation:image_generation",
        "--model",
        "veo-3.1-generate-preview:video_generation:video_generation",
        "--default-model",
        "glm-5.1",
        "--json",
      );

      const provider = JSON.parse(output);
      expect(provider.models).toEqual([
        { id: "glm-5.1", type: "openai-chat-compatible", apiMode: "chat_completions", kind: "llm" },
        { id: "qwen-image-2.0-pro", apiMode: "image_generation", kind: "image_generation" },
        { id: "veo-3.1-generate-preview", apiMode: "video_generation", kind: "video_generation" },
      ]);
      const config = JSON.parse(stripJsonc(await readFile(join(home, ".ai-agent-switch/config.jsonc"), "utf8")));
      expect(config.providers.aiproxy.models).toEqual(provider.models);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("provider init accepts model ids containing colons with explicit kind", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-provider-init-colon-model-"));
    try {
      const output = await run(
        home,
        "provider",
        "init",
        "--id",
        "aiproxy",
        "--name",
        "AIProxy",
        "--base-url",
        "https://aiproxy.usw-1.sealos.io/v1",
        "--api-key-env",
        "AIPROXY_API_KEY",
        "--model",
        "vendor/model:release:image_generation:image_generation",
        "--default-model",
        "vendor/model:release",
        "--json",
      );

      const provider = JSON.parse(output);
      expect(provider.models).toEqual([
        { id: "vendor/model:release", apiMode: "image_generation", kind: "image_generation" },
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("provider init stores one AIProxy provider with per-model API modes", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-provider-init-"));
    try {
      const output = await run(
        home,
        "provider",
        "init",
        "--id",
        "aiproxy",
        "--name",
        "AIProxy",
        "--base-url",
        "https://aiproxy.usw-1.sealos.io/v1",
        "--api-key-env",
        "AIPROXY_API_KEY",
        "--model",
        "glm-5.1:chat_completions",
        "--model",
        "qwen-image-2.0-pro:openai_compatible",
        "--model",
        "gpt-5.4-mini:codex_responses",
        "--model",
        "claude-sonnet-4-6:anthropic_messages",
        "--default-model",
        "gpt-5.4-mini",
        "--json",
      );

      const provider = JSON.parse(output);
      expect(provider.id).toBe("aiproxy");
      const config = JSON.parse(stripJsonc(await readFile(join(home, ".ai-agent-switch/config.jsonc"), "utf8")));
      expect(config.providers.aiproxy).toMatchObject({
        id: "aiproxy",
        name: "AIProxy",
        type: "openai-chat-compatible",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKeyEnv: "AIPROXY_API_KEY",
        defaultModel: "gpt-5.4-mini",
      });
      expect(config.providers.aiproxy.models).toEqual([
        { id: "glm-5.1", type: "openai-chat-compatible", apiMode: "chat_completions" },
        { id: "qwen-image-2.0-pro", type: "openai-chat-compatible", apiMode: "openai_compatible" },
        { id: "gpt-5.4-mini", type: "openai-responses", apiMode: "codex_responses" },
        { id: "claude-sonnet-4-6", type: "anthropic", apiMode: "anthropic_messages" },
      ]);
      expect(config.clients).toEqual({});
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("provider init rejects models without explicit API mode", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-provider-init-api-mode-"));
    try {
      const result = await runExpectingFailure(
        home,
        "provider",
        "init",
        "--id",
        "aiproxy",
        "--name",
        "AIProxy",
        "--model",
        "glm-5.1",
      );

      expect(result.stderr).toContain("Expected modelId:apiMode");
      expect(result.exitCode).toBe(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("provider init rejects inline API keys", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-provider-init-inline-key-"));
    try {
      const result = await runExpectingFailure(
        home,
        "provider",
        "init",
        "--id",
        "aiproxy",
        "--name",
        "AIProxy",
        "--api-key",
        "sk-test",
        "--model",
        "glm-5.1:chat_completions",
      );

      expect(result.stderr).toContain("provider init does not support --api-key; use --api-key-env");
      expect(result.exitCode).toBe(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("provider init reports invalid model API mode as part of --model", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-provider-init-invalid-api-mode-"));
    try {
      const result = await runExpectingFailure(
        home,
        "provider",
        "init",
        "--id",
        "aiproxy",
        "--name",
        "AIProxy",
        "--model",
        "glm-5.1:responses",
      );

      expect(result.stderr).toContain("Invalid apiMode in --model: responses");
      expect(result.exitCode).toBe(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("provider init rejects non-LLM models without explicit kind", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-provider-init-kind-required-"));
    try {
      const result = await runExpectingFailure(
        home,
        "provider",
        "init",
        "--id",
        "aiproxy",
        "--name",
        "AIProxy",
        "--model",
        "glm-5.1:chat_completions",
        "--model",
        "qwen-image-2.0-pro:image_generation",
      );

      expect(result.stderr).toContain("Model qwen-image-2.0-pro with apiMode image_generation requires explicit kind image_generation");
      expect(result.exitCode).toBe(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("provider init rejects api mode and kind mismatch", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-provider-init-kind-mismatch-"));
    try {
      const result = await runExpectingFailure(
        home,
        "provider",
        "init",
        "--id",
        "aiproxy",
        "--name",
        "AIProxy",
        "--model",
        "glm-5.1:chat_completions:image_generation",
      );

      expect(result.stderr).toContain("Model glm-5.1 with apiMode chat_completions does not support kind image_generation");
      expect(result.exitCode).toBe(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("provider init rejects duplicate model ids", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-provider-init-duplicate-"));
    try {
      const result = await runExpectingFailure(
        home,
        "provider",
        "init",
        "--id",
        "aiproxy",
        "--name",
        "AIProxy",
        "--model",
        "glm-5.1:chat_completions",
        "--model",
        "glm-5.1:codex_responses",
      );

      expect(result.stderr).toContain("Duplicate model for provider aiproxy: glm-5.1");
      expect(result.exitCode).toBe(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("provider init removes stale route candidates for the same provider", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-provider-init-route-clean-"));
    try {
      await run(
        home,
        "provider",
        "init",
        "--id",
        "aiproxy",
        "--name",
        "AIProxy",
        "--model",
        "glm-5.1:chat_completions",
        "--default-model",
        "glm-5.1",
      );
      await run(home, "route", "set-default", "aiproxy/glm-5.1");
      await run(
        home,
        "provider",
        "init",
        "--id",
        "aiproxy",
        "--name",
        "AIProxy",
        "--model",
        "gpt-5.4-mini:codex_responses",
        "--default-model",
        "gpt-5.4-mini",
      );

      const route = JSON.parse(await run(home, "route", "list", "--json")) as { candidates: { providerId: string; modelId: string }[] };
      expect(route.candidates).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("route commands configure default proxy fallback chain", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-route-"));
    try {
      await run(home, "provider", "add", "--id", "openrouter", "--name", "OpenRouter", "--type", "openai-compatible", "--base-url", "https://openrouter.ai/api/v1", "--model", "a");
      await run(home, "provider", "model-add", "openrouter", "b");
      await run(home, "route", "set-default", "openrouter/a");
      await run(home, "route", "add-fallback", "openrouter/b");
      const output = await run(home, "route", "list");

      expect(output).toContain("primary openrouter/a");
      expect(output).toContain("fallback 1 openrouter/b");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("switch command applies provider default model to one client", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-switch-"));
    try {
      await run(
        home,
        "provider",
        "init",
        "--id",
        "aiproxy",
        "--name",
        "AIProxy",
        "--base-url",
        "https://aiproxy.usw-1.sealos.io/v1",
        "--api-key-env",
        "AIPROXY_API_KEY",
        "--model",
        "glm-5.1:chat_completions",
        "--model",
        "gpt-5.4-mini:codex_responses",
        "--default-model",
        "gpt-5.4-mini",
      );

      const output = await run(home, "switch", "--client", "openclaw", "--provider", "aiproxy", "-y", "--json");
      const parsed = JSON.parse(output) as { applied: boolean; requiresConfirmation: boolean };
      expect(parsed).toMatchObject({ applied: true, requiresConfirmation: false });

      const config = JSON.parse(await readFile(join(home, ".openclaw/openclaw.json"), "utf8"));
      expect(config.agents.defaults.model.primary).toBe("aiproxy/gpt-5.4-mini");
      expect(config.models.providers.aiproxy.api).toBe("openai-responses");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("switch command can select an explicit model", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-switch-explicit-"));
    try {
      await run(
        home,
        "provider",
        "init",
        "--id",
        "aiproxy",
        "--name",
        "AIProxy",
        "--base-url",
        "https://aiproxy.usw-1.sealos.io/v1",
        "--api-key-env",
        "AIPROXY_API_KEY",
        "--model",
        "glm-5.1:chat_completions",
        "--model",
        "gpt-5.4-mini:codex_responses",
        "--default-model",
        "gpt-5.4-mini",
      );

      await run(home, "switch", "--client", "hermes", "--provider", "aiproxy", "--model", "glm-5.1", "-y");

      const config = await readFile(join(home, ".hermes/config.yaml"), "utf8");
      expect(config).toContain("provider: aiproxy");
      expect(config).toContain("default: glm-5.1");
      expect(config).toContain("transport: openai_chat");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("client use-proxy configures one client for the local ai-agent-switch proxy", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cli-client-proxy-"));
    try {
      const preview = await run(home, "client", "use-proxy", "qwen", "--dry-run", "--json");
      const planned = JSON.parse(preview) as { applied: boolean; requiresConfirmation: boolean; plan: { summary: string } };
      expect(planned.applied).toBe(false);
      expect(planned.requiresConfirmation).toBe(true);
      expect(planned.plan.summary).toContain("ai-agent-switch-proxy/ai-agent-switch/default");

      await run(home, "client", "use-proxy", "qwen", "-y");

      const settings = JSON.parse(await readFile(join(home, ".qwen/settings.json"), "utf8"));
      expect(settings.security.auth.selectedType).toBe("ai-agent-switch-proxy");
      expect(settings.model.name).toBe("ai-agent-switch/default");
      expect(settings.modelProviders["ai-agent-switch-proxy"].baseUrl).toBe("http://127.0.0.1:17890/v1");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

async function run(home: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["bun", cliPath, ...args], {
    env: { ...process.env, HOME: home, AI_AGENT_SWITCH_HOME: join(home, ".ai-agent-switch"), NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`Command failed: ${args.join(" ")}\n${stderr}`);
  return stdout;
}

async function runExpectingFailure(home: string, ...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", cliPath, ...args], {
    env: { ...process.env, HOME: home, AI_AGENT_SWITCH_HOME: join(home, ".ai-agent-switch"), NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (exitCode === 0) throw new Error(`Command unexpectedly succeeded: ${args.join(" ")}\n${stdout}`);
  return { exitCode, stdout, stderr };
}

function stripJsonc(text: string): string {
  return text.replace(/^\s*\/\/.*$/gm, "");
}
