import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClientAdapters } from "../src/clients";
import type { ProviderProfile } from "../src/config/schema";

const provider: ProviderProfile = {
  id: "openrouter",
  name: "OpenRouter",
  type: "openai-compatible",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKeyEnv: "OPENROUTER_API_KEY",
  models: [{ id: "qwen/qwen3-coder" }],
};

describe("extended client adapters", () => {
  test("gemini adapter patches model provider settings", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-gemini-"));
    try {
      await mkdir(join(home, ".gemini"), { recursive: true });
      await writeFile(join(home, ".gemini/settings.json"), JSON.stringify({ keep: true }, null, 2));
      const gemini = createClientAdapters({ homeDir: home, cwd: home }).get("gemini")!;

      const plan = await gemini.planApply({ provider, modelId: "qwen/qwen3-coder" });
      await gemini.apply(plan);

      const parsed = JSON.parse(await readFile(join(home, ".gemini/settings.json"), "utf8"));
      expect(parsed.keep).toBe(true);
      expect(parsed.model.name).toBe("qwen/qwen3-coder");
      expect(parsed.auth.selectedType).toBe("openrouter");
      expect(parsed.modelProviders.openrouter.envKey).toBe("OPENROUTER_API_KEY");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("openclaw adapter preserves provider/model/runtime separation", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-openclaw-"));
    try {
      await mkdir(join(home, ".openclaw"), { recursive: true });
      await writeFile(join(home, ".openclaw/openclaw.json"), `{"agents":{"defaults":{"agentRuntime":{"id":"codex"}}}}`);
      const openclaw = createClientAdapters({ homeDir: home, cwd: home }).get("openclaw")!;

      await openclaw.apply(await openclaw.planApply({ provider, modelId: "qwen/qwen3-coder" }));

      const parsed = JSON.parse(await readFile(join(home, ".openclaw/openclaw.json"), "utf8"));
      expect(parsed.agents.defaults.agentRuntime.id).toBe("codex");
      expect(parsed.agents.defaults.model.primary).toBe("openrouter/qwen/qwen3-coder");
      expect(parsed.models.providers.openrouter.api).toBe("openai-completions");
      expect(parsed.models.providers.openrouter.apiKey).toEqual({ source: "env", provider: "default", id: "OPENROUTER_API_KEY" });
      expect(parsed.models.providers.openrouter.models).toEqual([
        { id: "qwen/qwen3-coder", name: "qwen/qwen3-coder", api: "openai-completions" },
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("openclaw adapter maps Anthropic providers to messages transport", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-openclaw-anthropic-"));
    try {
      await mkdir(join(home, ".openclaw"), { recursive: true });
      const openclaw = createClientAdapters({ homeDir: home, cwd: home }).get("openclaw")!;
      const anthropicProvider: ProviderProfile = {
        id: "aiproxy-anthropic",
        name: "Ai Proxy Anthropic",
        type: "anthropic",
        baseUrl: "https://aiproxy.hzh.sealos.run/v1",
        apiKeyEnv: "AIPROXY_API_KEY",
        models: [{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" }],
      };

      await openclaw.apply(await openclaw.planApply({ provider: anthropicProvider, modelId: "deepseek-v4-pro" }));

      const parsed = JSON.parse(await readFile(join(home, ".openclaw/openclaw.json"), "utf8"));
      expect(parsed.agents.defaults.model.primary).toBe("aiproxy-anthropic/deepseek-v4-pro");
      expect(parsed.models.providers["aiproxy-anthropic"].api).toBe("anthropic-messages");
      expect(parsed.models.providers["aiproxy-anthropic"].apiKey).toEqual({ source: "env", provider: "default", id: "AIPROXY_API_KEY" });
      expect(parsed.models.providers["aiproxy-anthropic"].models).toEqual([
        { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", api: "anthropic-messages" },
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("openclaw adapter maps selected model type even when provider type differs", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-openclaw-model-type-"));
    try {
      await mkdir(join(home, ".openclaw"), { recursive: true });
      const openclaw = createClientAdapters({ homeDir: home, cwd: home }).get("openclaw")!;
      const aiproxyProvider: ProviderProfile = {
        id: "aiproxy",
        name: "AI Proxy",
        type: "openai-chat-compatible",
        baseUrl: "https://aiproxy.hzh.sealos.run/v1",
        apiKeyEnv: "AIPROXY_API_KEY",
        models: [
          { id: "gpt-5.4", type: "openai-responses" },
          { id: "glm-4.6", type: "openai-chat-compatible" },
        ],
      };

      await openclaw.apply(await openclaw.planApply({ provider: aiproxyProvider, modelId: "gpt-5.4" }));

      const parsed = JSON.parse(await readFile(join(home, ".openclaw/openclaw.json"), "utf8"));
      expect(parsed.agents.defaults.model.primary).toBe("aiproxy/gpt-5.4");
      expect(parsed.models.providers.aiproxy.api).toBe("openai-responses");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("openclaw adapter writes per-model api for one AIProxy provider", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-openclaw-aiproxy-api-"));
    try {
      await mkdir(join(home, ".openclaw"), { recursive: true });
      const openclaw = createClientAdapters({ homeDir: home, cwd: home }).get("openclaw")!;
      const aiproxyProvider: ProviderProfile = {
        id: "aiproxy",
        name: "AIProxy",
        type: "openai-chat-compatible",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKeyEnv: "AIPROXY_API_KEY",
        models: [
          { id: "glm-5.1", type: "openai-chat-compatible" },
          { id: "gpt-5.4-mini", type: "openai-responses" },
          { id: "claude-sonnet-4-6", type: "anthropic" },
        ],
        defaultModel: "gpt-5.4-mini",
      };

      await openclaw.apply(await openclaw.planApply({ provider: aiproxyProvider, modelId: "gpt-5.4-mini" }));

      const parsed = JSON.parse(await readFile(join(home, ".openclaw/openclaw.json"), "utf8"));
      expect(parsed.agents.defaults.model.primary).toBe("aiproxy/gpt-5.4-mini");
      expect(parsed.models.providers.aiproxy.api).toBe("openai-responses");
      expect(parsed.models.providers.aiproxy.models).toEqual([
        { id: "glm-5.1", name: "glm-5.1", api: "openai-completions" },
        { id: "gpt-5.4-mini", name: "gpt-5.4-mini", api: "openai-responses" },
        { id: "claude-sonnet-4-6", name: "claude-sonnet-4-6", api: "anthropic-messages" },
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("crush adapter patches large model without touching sessions", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-crush-"));
    try {
      await mkdir(join(home, ".config/crush"), { recursive: true });
      await writeFile(join(home, ".config/crush/crush.json"), JSON.stringify({ session_dir: "keep" }, null, 2));
      const crush = createClientAdapters({ homeDir: home, cwd: home }).get("crush")!;

      await crush.apply(await crush.planApply({ provider, modelId: "qwen/qwen3-coder" }));

      const parsed = JSON.parse(await readFile(join(home, ".config/crush/crush.json"), "utf8"));
      expect(parsed.session_dir).toBe("keep");
      expect(parsed.models.large).toEqual({ provider: "openrouter", model: "qwen/qwen3-coder" });
      expect(parsed.providers.openrouter.type).toBe("openai-compat");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("crush adapter maps explicit OpenAI Chat-compatible providers to openai-compat", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-crush-chat-"));
    try {
      await mkdir(join(home, ".config/crush"), { recursive: true });
      const crush = createClientAdapters({ homeDir: home, cwd: home }).get("crush")!;
      const chatProvider: ProviderProfile = {
        ...provider,
        type: "openai-chat-compatible",
      };

      await crush.apply(await crush.planApply({ provider: chatProvider, modelId: "qwen/qwen3-coder" }));

      const parsed = JSON.parse(await readFile(join(home, ".config/crush/crush.json"), "utf8"));
      expect(parsed.providers.openrouter.type).toBe("openai-compat");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("opencode adapter patches coder agent provider/model", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-opencode-"));
    try {
      await writeFile(join(home, ".opencode.json"), JSON.stringify({ keep: true }, null, 2));
      const opencode = createClientAdapters({ homeDir: home, cwd: home }).get("opencode")!;

      await opencode.apply(await opencode.planApply({ provider, modelId: "qwen/qwen3-coder" }));

      const parsed = JSON.parse(await readFile(join(home, ".opencode.json"), "utf8"));
      expect(parsed.keep).toBe(true);
      expect(parsed.agents.coder.provider).toBe("openrouter");
      expect(parsed.agents.coder.model).toBe("qwen/qwen3-coder");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cowagent adapter patches global config without dropping unknown fields", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-"));
    try {
      await mkdir(join(home, "CowAgent"), { recursive: true });
      await writeFile(join(home, "CowAgent/config.json"), JSON.stringify({ channel_type: "feishu", agent: true }, null, 2));
      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
      const compatibleProvider: ProviderProfile = {
        id: "aiproxy-openai",
        name: "Ai Proxy OpenAI",
        type: "openai-chat-compatible",
        baseUrl: "https://aiproxy.hzh.sealos.run/v1",
        apiKey: { kind: "inline", value: "sk-test" },
        models: [{ id: "deepseek-v4-flash" }],
      };

      await cowagent.apply(await cowagent.planApply({ provider: compatibleProvider, modelId: "deepseek-v4-flash" }));

      const parsed = JSON.parse(await readFile(join(home, "CowAgent/config.json"), "utf8"));
      expect(parsed.channel_type).toBe("feishu");
      expect(parsed.agent).toBe(true);
      expect(parsed.model).toBe("deepseek-v4-flash");
      expect(parsed.bot_type).toBe("openai");
      expect(parsed.open_ai_api_base).toBe("https://aiproxy.hzh.sealos.run/v1");
      expect(parsed.open_ai_api_key).toBe("sk-test");
      expect(parsed.ai_agent_switch).toMatchObject({ provider: "aiproxy-openai", model: "deepseek-v4-flash" });
      expect(parsed.ai_agent_switch.live_apply).toEqual({
        providers: [{ providerId: "openai", apiKey: "sk-test", apiBase: "https://aiproxy.hzh.sealos.run/v1" }],
        capabilities: [{ capability: "chat", providerId: "openai", model: "deepseek-v4-flash" }],
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cowagent adapter maps Anthropic providers to Claude native config", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-anthropic-"));
    try {
      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
      const anthropicProvider: ProviderProfile = {
        id: "aiproxy-anthropic",
        name: "Ai Proxy Anthropic",
        type: "anthropic",
        baseUrl: "https://aiproxy.hzh.sealos.io/v1",
        apiKeyEnv: "OPEN_AI_API_KEY",
        models: [{ id: "claude-opus-4-7", name: "Claude Opus 4.7" }],
      };

      process.env.OPEN_AI_API_KEY = "sk-anthropic-from-env";
      await cowagent.apply(await cowagent.planApply({ provider: anthropicProvider, modelId: "claude-opus-4-7" }));
      delete process.env.OPEN_AI_API_KEY;

      const parsed = JSON.parse(await readFile(join(home, "CowAgent/config.json"), "utf8"));
      expect(parsed.model).toBe("claude-opus-4-7");
      expect(parsed.bot_type).toBe("claudeAPI");
      expect(parsed.claude_api_base).toBe("https://aiproxy.hzh.sealos.io/anthropic");
      expect(parsed.claude_api_key).toBe("sk-anthropic-from-env");
      expect(parsed.ai_agent_switch).toMatchObject({ provider: "aiproxy-anthropic", model: "claude-opus-4-7" });
      expect(parsed.ai_agent_switch.live_apply).toEqual({
        providers: [{ providerId: "claudeAPI", apiKey: "sk-anthropic-from-env", apiBase: "https://aiproxy.hzh.sealos.io/anthropic" }],
        capabilities: [{ capability: "chat", providerId: "claudeAPI", model: "claude-opus-4-7" }],
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cowagent adapter rejects OpenAI Responses providers", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-responses-"));
    try {
      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
      const responsesProvider: ProviderProfile = {
        id: "aiproxy-responses",
        name: "Ai Proxy Responses",
        type: "openai-responses",
        baseUrl: "https://aiproxy.hzh.sealos.run/v1",
        apiKeyEnv: "AIPROXY_API_KEY",
        models: [{ id: "gpt-5.4-mini" }],
      };

      await expect(cowagent.planApply({ provider: responsesProvider, modelId: "gpt-5.4-mini" })).rejects.toThrow(
        "CowAgent requires an OpenAI Chat-compatible provider",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });


  test("cowagent adapter normalizes AIProxy Anthropic base URL for Claude native config", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-aiproxy-anthropic-base-"));
    try {
      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
      const anthropicProvider: ProviderProfile = {
        id: "aiproxy",
        name: "AI Proxy",
        type: "openai-chat-compatible",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKeyEnv: "OPEN_AI_API_KEY",
        models: [{ id: "claude-opus-4-7", type: "anthropic", apiMode: "anthropic_messages", kind: "llm" }],
      };

      process.env.OPEN_AI_API_KEY = "sk-aiproxy-anthropic";
      await cowagent.apply(await cowagent.planApply({ provider: anthropicProvider, modelId: "claude-opus-4-7" }));
      delete process.env.OPEN_AI_API_KEY;

      const parsed = JSON.parse(await readFile(join(home, "CowAgent/config.json"), "utf8"));
      expect(parsed.claude_api_base).toBe("https://aiproxy.usw-1.sealos.io/anthropic");
      expect(parsed.ai_agent_switch.live_apply.providers).toEqual([
        { providerId: "claudeAPI", apiKey: "sk-aiproxy-anthropic", apiBase: "https://aiproxy.usw-1.sealos.io/anthropic" },
      ]);
    } finally {
      delete process.env.OPEN_AI_API_KEY;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cowagent adapter keeps AIProxy chat and Anthropic slots on separate endpoints", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-aiproxy-endpoints-"));
    try {
      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
      const chatProvider: ProviderProfile = {
        id: "aiproxy-chat",
        name: "AI Proxy Chat",
        type: "openai-chat-compatible",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKeyEnv: "OPEN_AI_API_KEY",
        models: [{ id: "gpt-5.4-mini", type: "openai-chat-compatible", kind: "llm" }],
      };
      const anthropicProvider: ProviderProfile = {
        id: "aiproxy-anthropic",
        name: "AI Proxy Anthropic",
        type: "anthropic",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKeyEnv: "OPEN_AI_API_KEY",
        models: [{ id: "claude-opus-4-7", type: "anthropic", kind: "llm" }],
      };

      process.env.OPEN_AI_API_KEY = "sk-aiproxy";
      await cowagent.apply(await cowagent.planApplySlots!({
        slots: [
          { slot: "main", provider: anthropicProvider, modelId: "claude-opus-4-7" },
          { slot: "vision", provider: chatProvider, modelId: "gpt-5.4-mini" },
        ],
      }));
      delete process.env.OPEN_AI_API_KEY;

      const parsed = JSON.parse(await readFile(join(home, "CowAgent/config.json"), "utf8"));
      expect(parsed.bot_type).toBe("claudeAPI");
      expect(parsed.claude_api_base).toBe("https://aiproxy.usw-1.sealos.io/anthropic");
      expect(parsed.open_ai_api_base).toBe("https://aiproxy.usw-1.sealos.io/v1");
      expect(parsed.tools.vision).toEqual({ provider: "openai", model: "gpt-5.4-mini" });
      expect(parsed.ai_agent_switch.slots).toEqual({
        main: { provider: "aiproxy-anthropic", model: "claude-opus-4-7" },
        vision: { provider: "aiproxy-chat", model: "gpt-5.4-mini" },
      });
    } finally {
      delete process.env.OPEN_AI_API_KEY;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cowagent adapter maps Anthropic vision slots to Claude native config", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-claude-vision-"));
    try {
      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
      const anthropicProvider: ProviderProfile = {
        id: "aiproxy-anthropic",
        name: "AI Proxy Anthropic",
        type: "anthropic",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKeyEnv: "OPEN_AI_API_KEY",
        models: [
          { id: "claude-opus-4-7", type: "anthropic", kind: "llm" },
          { id: "claude-sonnet-4-6", type: "anthropic", kind: "llm" },
        ],
      };

      process.env.OPEN_AI_API_KEY = "sk-claude-vision";
      await cowagent.apply(await cowagent.planApplySlots!({
        slots: [
          { slot: "main", provider: anthropicProvider, modelId: "claude-opus-4-7" },
          { slot: "vision", provider: anthropicProvider, modelId: "claude-sonnet-4-6" },
        ],
      }));
      delete process.env.OPEN_AI_API_KEY;

      const parsed = JSON.parse(await readFile(join(home, "CowAgent/config.json"), "utf8"));
      expect(parsed.bot_type).toBe("claudeAPI");
      expect(parsed.claude_api_base).toBe("https://aiproxy.usw-1.sealos.io/anthropic");
      expect(parsed.claude_api_key).toBe("sk-claude-vision");
      expect(parsed.tools.vision).toEqual({ provider: "claudeAPI", model: "claude-sonnet-4-6" });
      expect(parsed.ai_agent_switch.live_apply).toEqual({
        providers: [{ providerId: "claudeAPI", apiKey: "sk-claude-vision", apiBase: "https://aiproxy.usw-1.sealos.io/anthropic" }],
        capabilities: [
          { capability: "chat", providerId: "claudeAPI", model: "claude-opus-4-7" },
          { capability: "vision", providerId: "claudeAPI", model: "claude-sonnet-4-6" },
        ],
      });
    } finally {
      delete process.env.OPEN_AI_API_KEY;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cowagent adapter maps Anthropic capability slots by API mode, not model prefix", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-anthropic-capability-"));
    try {
      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
      const chatProvider: ProviderProfile = {
        id: "aiproxy-chat",
        name: "AI Proxy Chat",
        type: "openai-chat-compatible",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKeyEnv: "OPEN_AI_API_KEY",
        models: [{ id: "glm-5.1", type: "openai-chat-compatible", kind: "llm" }],
      };
      const anthropicProvider: ProviderProfile = {
        id: "aiproxy-anthropic",
        name: "AI Proxy Anthropic",
        type: "anthropic",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKeyEnv: "OPEN_AI_API_KEY",
        models: [{ id: "deepseek-v4-pro", type: "anthropic", kind: "llm" }],
      };

      process.env.OPEN_AI_API_KEY = "sk-anthropic-capability";
      await cowagent.apply(await cowagent.planApplySlots!({
        slots: [
          { slot: "main", provider: chatProvider, modelId: "glm-5.1" },
          { slot: "vision", provider: anthropicProvider, modelId: "deepseek-v4-pro" },
        ],
      }));
      delete process.env.OPEN_AI_API_KEY;

      const parsed = JSON.parse(await readFile(join(home, "CowAgent/config.json"), "utf8"));
      expect(parsed.model).toBe("glm-5.1");
      expect(parsed.bot_type).toBe("openai");
      expect(parsed.tools.vision).toEqual({ provider: "claudeAPI", model: "deepseek-v4-pro" });
      expect(parsed.claude_api_base).toBe("https://aiproxy.usw-1.sealos.io/anthropic");
      expect(parsed.claude_api_key).toBe("sk-anthropic-capability");
      expect(parsed.ai_agent_switch.live_apply).toEqual({
        providers: [
          { providerId: "openai", apiKey: "sk-anthropic-capability", apiBase: "https://aiproxy.usw-1.sealos.io/v1" },
          { providerId: "claudeAPI", apiKey: "sk-anthropic-capability", apiBase: "https://aiproxy.usw-1.sealos.io/anthropic" },
        ],
        capabilities: [
          { capability: "chat", providerId: "openai", model: "glm-5.1" },
          { capability: "vision", providerId: "claudeAPI", model: "deepseek-v4-pro" },
        ],
      });
    } finally {
      delete process.env.OPEN_AI_API_KEY;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cowagent adapter live-applies provider and capability through CowAgent API when required", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-live-"));
    const calls: Array<{ path: string; body: unknown; cookie: string }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/auth/login") {
          calls.push({ path: url.pathname, body: await request.json(), cookie: request.headers.get("cookie") ?? "" });
          return new Response(JSON.stringify({ status: "success" }), {
            headers: { "set-cookie": "cow_auth_token=test-token; Path=/; HttpOnly" },
          });
        }
        if (url.pathname === "/api/models") {
          calls.push({ path: url.pathname, body: await request.json(), cookie: request.headers.get("cookie") ?? "" });
          return Response.json({ status: "success" });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const previousPort = process.env.COWAGENT_WEB_PORT;
    const previousPassword = process.env.COWAGENT_WEB_PASSWORD;
    const previousLiveApply = process.env.AI_AGENT_SWITCH_COWAGENT_LIVE_APPLY;
    const previousOpenAIKey = process.env.OPEN_AI_API_KEY;
    try {
      await mkdir(join(home, "CowAgent"), { recursive: true });
      await writeFile(join(home, "CowAgent/config.json"), JSON.stringify({
        voice_to_text: "openai",
        voice_to_text_model: "whisper-1",
      }, null, 2));

      process.env.COWAGENT_WEB_PORT = String(server.port);
      process.env.COWAGENT_WEB_PASSWORD = "pw-test";
      process.env.AI_AGENT_SWITCH_COWAGENT_LIVE_APPLY = "required";
      process.env.OPEN_AI_API_KEY = "sk-live";

      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
      const anthropicProvider: ProviderProfile = {
        id: "aiproxy-anthropic",
        name: "AI Proxy Anthropic",
        type: "anthropic",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKeyEnv: "OPEN_AI_API_KEY",
        models: [{ id: "claude-opus-4-7", type: "anthropic", kind: "llm" }],
      };
      const chatProvider: ProviderProfile = {
        id: "aiproxy-chat",
        name: "AI Proxy Chat",
        type: "openai-chat-compatible",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKeyEnv: "OPEN_AI_API_KEY",
        models: [
          { id: "gpt-5.4-mini", type: "openai-chat-compatible", kind: "llm" },
          { id: "gpt-4o-mini-transcribe", type: "openai-chat-compatible", kind: "asr" },
        ],
      };

      await cowagent.apply(await cowagent.planApplySlots!({
        slots: [
          { slot: "main", provider: anthropicProvider, modelId: "claude-opus-4-7" },
          { slot: "vision", provider: chatProvider, modelId: "gpt-5.4-mini" },
          { slot: "asr", provider: chatProvider, modelId: "gpt-4o-mini-transcribe" },
        ],
      }));

      expect(calls).toEqual([
        { path: "/auth/login", body: { password: "pw-test" }, cookie: "" },
        {
          path: "/api/models",
          body: {
            action: "set_provider",
            provider_id: "claudeAPI",
            api_key: "sk-live",
            api_base: "https://aiproxy.usw-1.sealos.io/anthropic",
          },
          cookie: "cow_auth_token=test-token",
        },
        {
          path: "/api/models",
          body: {
            action: "set_provider",
            provider_id: "openai",
            api_key: "sk-live",
            api_base: "https://aiproxy.usw-1.sealos.io/v1",
          },
          cookie: "cow_auth_token=test-token",
        },
        {
          path: "/api/models",
          body: {
            action: "set_capability",
            capability: "chat",
            provider_id: "claudeAPI",
            model: "claude-opus-4-7",
          },
          cookie: "cow_auth_token=test-token",
        },
        {
          path: "/api/models",
          body: {
            action: "set_capability",
            capability: "vision",
            provider_id: "openai",
            model: "gpt-5.4-mini",
          },
          cookie: "cow_auth_token=test-token",
        },
        {
          path: "/api/models",
          body: {
            action: "set_capability",
            capability: "asr",
            provider_id: "openai",
            model: "gpt-4o-mini-transcribe",
          },
          cookie: "cow_auth_token=test-token",
        },
      ]);

      const parsed = JSON.parse(await readFile(join(home, "CowAgent/config.json"), "utf8"));
      expect(parsed.open_ai_api_key).toBe("sk-live");
    } finally {
      server.stop(true);
      if (previousPort === undefined) delete process.env.COWAGENT_WEB_PORT; else process.env.COWAGENT_WEB_PORT = previousPort;
      if (previousPassword === undefined) delete process.env.COWAGENT_WEB_PASSWORD; else process.env.COWAGENT_WEB_PASSWORD = previousPassword;
      if (previousLiveApply === undefined) delete process.env.AI_AGENT_SWITCH_COWAGENT_LIVE_APPLY; else process.env.AI_AGENT_SWITCH_COWAGENT_LIVE_APPLY = previousLiveApply;
      if (previousOpenAIKey === undefined) delete process.env.OPEN_AI_API_KEY; else process.env.OPEN_AI_API_KEY = previousOpenAIKey;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cowagent adapter does not write config when required live apply is rejected", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-live-atomic-"));
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/models") {
          return Response.json({ status: "error", message: "bad provider" });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const previousPort = process.env.COWAGENT_WEB_PORT;
    const previousLiveApply = process.env.AI_AGENT_SWITCH_COWAGENT_LIVE_APPLY;
    try {
      await mkdir(join(home, "CowAgent"), { recursive: true });
      await writeFile(join(home, "CowAgent/config.json"), JSON.stringify({
        bot_type: "openai",
        model: "old-model",
      }, null, 2));
      process.env.COWAGENT_WEB_PORT = String(server.port);
      process.env.AI_AGENT_SWITCH_COWAGENT_LIVE_APPLY = "required";

      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
      const provider: ProviderProfile = {
        id: "aiproxy-chat",
        name: "AI Proxy Chat",
        type: "openai-chat-compatible",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKey: { kind: "inline", value: "sk-live" },
        models: [{ id: "glm-5.1", type: "openai-chat-compatible", kind: "llm" }],
      };

      await expect(cowagent.apply(await cowagent.planApply({ provider, modelId: "glm-5.1" }))).rejects.toThrow("bad provider");
      const parsed = JSON.parse(await readFile(join(home, "CowAgent/config.json"), "utf8"));
      expect(parsed).toEqual({ bot_type: "openai", model: "old-model" });
    } finally {
      server.stop(true);
      if (previousPort === undefined) delete process.env.COWAGENT_WEB_PORT; else process.env.COWAGENT_WEB_PORT = previousPort;
      if (previousLiveApply === undefined) delete process.env.AI_AGENT_SWITCH_COWAGENT_LIVE_APPLY; else process.env.AI_AGENT_SWITCH_COWAGENT_LIVE_APPLY = previousLiveApply;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cowagent adapter fails when required live apply is rejected by CowAgent API", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-live-error-"));
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/models") {
          return Response.json({ status: "error", message: "bad provider" });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const previousPort = process.env.COWAGENT_WEB_PORT;
    const previousLiveApply = process.env.AI_AGENT_SWITCH_COWAGENT_LIVE_APPLY;
    try {
      process.env.COWAGENT_WEB_PORT = String(server.port);
      process.env.AI_AGENT_SWITCH_COWAGENT_LIVE_APPLY = "required";

      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
      const provider: ProviderProfile = {
        id: "aiproxy-chat",
        name: "AI Proxy Chat",
        type: "openai-chat-compatible",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKey: { kind: "inline", value: "sk-live" },
        models: [{ id: "glm-5.1", type: "openai-chat-compatible", kind: "llm" }],
      };

      await expect(cowagent.apply(await cowagent.planApply({ provider, modelId: "glm-5.1" }))).rejects.toThrow("bad provider");
    } finally {
      server.stop(true);
      if (previousPort === undefined) delete process.env.COWAGENT_WEB_PORT; else process.env.COWAGENT_WEB_PORT = previousPort;
      if (previousLiveApply === undefined) delete process.env.AI_AGENT_SWITCH_COWAGENT_LIVE_APPLY; else process.env.AI_AGENT_SWITCH_COWAGENT_LIVE_APPLY = previousLiveApply;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cowagent adapter maps model slots to CowAgent capability config", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-slots-"));
    try {
      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
      const aiproxyProvider: ProviderProfile = {
        id: "aiproxy",
        name: "AI Proxy",
        type: "openai-chat-compatible",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKeyEnv: "OPEN_AI_API_KEY",
        models: [
          { id: "gpt-5.5", type: "openai-chat-compatible", kind: "llm" },
          { id: "gemini-3.5-flash", type: "openai-chat-compatible", kind: "llm" },
          { id: "gemini-3.1-flash-image-preview", type: "openai-chat-compatible", kind: "image_generation" },
          { id: "gpt-4o-mini-transcribe", type: "openai-chat-compatible", kind: "asr" },
          { id: "qwen3-tts-flash", type: "openai-chat-compatible", kind: "tts" },
          { id: "text-embedding-v4", type: "openai-chat-compatible", kind: "embedding" },
        ],
      };

      await cowagent.apply(await cowagent.planApplySlots!({
        slots: [
          { slot: "main", provider: aiproxyProvider, modelId: "gpt-5.5" },
          { slot: "vision", provider: aiproxyProvider, modelId: "gemini-3.5-flash" },
          { slot: "image", provider: aiproxyProvider, modelId: "gemini-3.1-flash-image-preview" },
          { slot: "asr", provider: aiproxyProvider, modelId: "gpt-4o-mini-transcribe" },
          { slot: "tts", provider: aiproxyProvider, modelId: "qwen3-tts-flash" },
          { slot: "embedding", provider: aiproxyProvider, modelId: "text-embedding-v4" },
        ],
      }));

      const parsed = JSON.parse(await readFile(join(home, "CowAgent/config.json"), "utf8"));
      expect(parsed.model).toBe("gpt-5.5");
      expect(parsed.bot_type).toBe("openai");
      expect(parsed.tools.vision).toEqual({ provider: "openai", model: "gemini-3.5-flash" });
      expect(parsed.skills["image-generation"]).toEqual({ provider: "openai", model: "gemini-3.1-flash-image-preview" });
      expect(parsed.voice_to_text).toBe("openai");
      expect(parsed.voice_to_text_model).toBe("gpt-4o-mini-transcribe");
      expect(parsed.text_to_voice).toBe("openai");
      expect(parsed.text_to_voice_model).toBe("qwen3-tts-flash");
      expect(parsed.embedding_provider).toBe("openai");
      expect(parsed.embedding_model).toBe("text-embedding-v4");
      expect(parsed.gemini_api_base).toBeUndefined();
      expect(parsed.dashscope_api_base).toBeUndefined();
      expect(parsed.ai_agent_switch.slots).toEqual({
        main: { provider: "aiproxy", model: "gpt-5.5" },
        vision: { provider: "aiproxy", model: "gemini-3.5-flash" },
        image: { provider: "aiproxy", model: "gemini-3.1-flash-image-preview" },
        asr: { provider: "aiproxy", model: "gpt-4o-mini-transcribe" },
        tts: { provider: "aiproxy", model: "qwen3-tts-flash" },
        embedding: { provider: "aiproxy", model: "text-embedding-v4" },
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cowagent adapter maps AIProxy native runtime providers for multimodal slots", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-native-slots-"));
    try {
      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
      const openAIProvider: ProviderProfile = {
        id: "aiproxy-openai",
        name: "AI Proxy OpenAI",
        type: "openai-chat-compatible",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        apiKeyEnv: "OPEN_AI_API_KEY",
        models: [
          { id: "gpt-5.5", type: "openai-chat-compatible", kind: "llm" },
          { id: "gpt-4o-mini-transcribe", kind: "asr" },
        ],
      };
      const geminiProvider: ProviderProfile = {
        id: "aiproxy-gemini",
        name: "AI Proxy Gemini",
        type: "gemini",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1beta",
        apiKeyEnv: "GEMINI_API_KEY",
        models: [
          { id: "gemini-3.5-flash", kind: "llm" },
          { id: "gemini-3.1-flash-image-preview", kind: "image_generation" },
        ],
      };
      const dashscopeProvider: ProviderProfile = {
        id: "aiproxy-dashscope",
        name: "AI Proxy DashScope",
        type: "dashscope",
        baseUrl: "https://aiproxy.usw-1.sealos.io",
        apiKeyEnv: "DASHSCOPE_API_KEY",
        models: [
          { id: "qwen3-tts-flash", kind: "tts" },
          { id: "text-embedding-v4", kind: "embedding" },
        ],
      };

      process.env.OPEN_AI_API_KEY = "sk-aiproxy";
      process.env.GEMINI_API_KEY = "sk-aiproxy";
      process.env.DASHSCOPE_API_KEY = "sk-aiproxy";
      await cowagent.apply(await cowagent.planApplySlots!({
        slots: [
          { slot: "main", provider: openAIProvider, modelId: "gpt-5.5" },
          { slot: "vision", provider: geminiProvider, modelId: "gemini-3.5-flash" },
          { slot: "image", provider: geminiProvider, modelId: "gemini-3.1-flash-image-preview" },
          { slot: "asr", provider: openAIProvider, modelId: "gpt-4o-mini-transcribe" },
          { slot: "tts", provider: dashscopeProvider, modelId: "qwen3-tts-flash" },
          { slot: "embedding", provider: dashscopeProvider, modelId: "text-embedding-v4" },
        ],
      }));

      const parsed = JSON.parse(await readFile(join(home, "CowAgent/config.json"), "utf8"));
      expect(parsed.tools.vision).toEqual({ provider: "gemini", model: "gemini-3.5-flash" });
      expect(parsed.skills["image-generation"]).toEqual({ provider: "gemini", model: "gemini-3.1-flash-image-preview" });
      expect(parsed.text_to_voice).toBe("dashscope");
      expect(parsed.text_to_voice_model).toBe("qwen3-tts-flash");
      expect(parsed.embedding_provider).toBe("dashscope");
      expect(parsed.embedding_model).toBe("text-embedding-v4");
      expect(parsed.gemini_api_base).toBe("https://aiproxy.usw-1.sealos.io");
      expect(parsed.gemini_api_key).toBe("sk-aiproxy");
      expect(parsed.dashscope_api_base).toBe("https://aiproxy.usw-1.sealos.io");
      expect(parsed.dashscope_api_key).toBe("sk-aiproxy");
      expect(parsed.ai_agent_switch.slots).toEqual({
        main: { provider: "aiproxy-openai", model: "gpt-5.5" },
        vision: { provider: "aiproxy-gemini", model: "gemini-3.5-flash" },
        image: { provider: "aiproxy-gemini", model: "gemini-3.1-flash-image-preview" },
        asr: { provider: "aiproxy-openai", model: "gpt-4o-mini-transcribe" },
        tts: { provider: "aiproxy-dashscope", model: "qwen3-tts-flash" },
        embedding: { provider: "aiproxy-dashscope", model: "text-embedding-v4" },
      });
    } finally {
      delete process.env.OPEN_AI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.DASHSCOPE_API_KEY;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cowagent adapter maps OpenAI TTS models to CowAgent audio config", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-openai-tts-"));
    try {
      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
      const aiproxyProvider: ProviderProfile = {
        id: "aiproxy",
        name: "AI Proxy",
        type: "openai-chat-compatible",
        baseUrl: "https://aiproxy.usw-1.sealos.io/v1",
        models: [
          { id: "gpt-5.4", type: "openai-chat-compatible", kind: "llm" },
          { id: "tts-1", type: "openai-chat-compatible", kind: "tts" },
        ],
        apiKeyEnv: "OPEN_AI_API_KEY",
      };

      await cowagent.apply(await cowagent.planApplySlots!({
        slots: [
          { slot: "main", provider: aiproxyProvider, modelId: "gpt-5.4" },
          { slot: "tts", provider: aiproxyProvider, modelId: "tts-1" },
        ],
      }));

      const parsed = JSON.parse(await readFile(join(home, "CowAgent/config.json"), "utf8"));
      expect(parsed.text_to_voice).toBe("openai");
      expect(parsed.text_to_voice_model).toBe("tts-1");
      expect(parsed.ai_agent_switch.slots.tts).toEqual({ provider: "aiproxy", model: "tts-1" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  const cowAgentProviderCases = [
    {
      type: "gemini",
      modelId: "gemini-3-pro-preview",
      baseUrl: "https://generativelanguage.googleapis.com",
      botType: "gemini",
      baseKey: "gemini_api_base",
      keyKey: "gemini_api_key",
    },
    {
      type: "deepseek",
      modelId: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com/v1",
      botType: "deepseek",
      baseKey: "deepseek_api_base",
      keyKey: "deepseek_api_key",
    },
    {
      type: "moonshot",
      modelId: "moonshot-v1-32k",
      baseUrl: "https://api.moonshot.cn/v1",
      botType: "moonshot",
      baseKey: "moonshot_base_url",
      keyKey: "moonshot_api_key",
    },
    {
      type: "dashscope",
      modelId: "qwen3.6-plus",
      botType: "dashscope",
      keyKey: "dashscope_api_key",
    },
  ] as const;

  for (const item of cowAgentProviderCases) {
    test(`cowagent adapter maps ${item.type} provider fields`, async () => {
      const home = await mkdtemp(join(tmpdir(), `ai-agent-switch-cowagent-${item.type}-`));
      try {
        const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;
        const mappedProvider: ProviderProfile = {
          id: `cowagent-${item.type}`,
          name: `CowAgent ${item.type}`,
          type: item.type,
          baseUrl: "baseUrl" in item ? item.baseUrl : undefined,
          apiKey: { kind: "inline", value: `${item.type}-key` },
          models: [{ id: item.modelId }],
        };

        await cowagent.apply(await cowagent.planApply({ provider: mappedProvider, modelId: item.modelId }));

        const parsed = JSON.parse(await readFile(join(home, "CowAgent/config.json"), "utf8"));
        expect(parsed.model).toBe(item.modelId);
        expect(parsed.bot_type).toBe(item.botType);
        if ("baseKey" in item) expect(parsed[item.baseKey]).toBe(item.baseUrl);
        expect(parsed[item.keyKey]).toBe(`${item.type}-key`);
        expect(parsed.ai_agent_switch).toMatchObject({ provider: `cowagent-${item.type}`, model: item.modelId });
        expect(parsed.ai_agent_switch.live_apply.capabilities).toEqual([
          { capability: "chat", providerId: item.botType, model: item.modelId },
        ]);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    });
  }

  test("cowagent adapter does not report bot_type as provider id", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-current-"));
    try {
      await mkdir(join(home, "CowAgent"), { recursive: true });
      await writeFile(join(home, "CowAgent/config.json"), JSON.stringify({ bot_type: "openai", model: "deepseek-v4-flash" }, null, 2));
      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;

      await expect(cowagent.getCurrent()).resolves.toMatchObject({
        clientId: "cowagent",
        providerId: undefined,
        modelId: "deepseek-v4-flash",
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("cowagent adapter rejects unsupported env key names instead of copying secrets", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-cowagent-env-"));
    try {
      const cowagent = createClientAdapters({ homeDir: home, cwd: home }).get("cowagent")!;

      await expect(cowagent.planApply({ provider, modelId: "qwen/qwen3-coder" })).rejects.toThrow("OPEN_AI_API_KEY");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("claude-code adapter writes only aiAgentSwitch namespace", async () => {
    const home = await mkdtemp(join(tmpdir(), "ai-agent-switch-claude-"));
    try {
      await mkdir(join(home, ".claude"), { recursive: true });
      await writeFile(join(home, ".claude/settings.json"), JSON.stringify({ existing: true }, null, 2));
      const claude = createClientAdapters({ homeDir: home, cwd: home }).get("claude-code")!;

      await claude.apply(await claude.planApply({ provider, modelId: "qwen/qwen3-coder" }));

      const parsed = JSON.parse(await readFile(join(home, ".claude/settings.json"), "utf8"));
      expect(parsed.existing).toBe(true);
      expect(parsed.aiAgentSwitch.provider).toBe("openrouter");
      expect(parsed.aiAgentSwitch.model).toBe("qwen/qwen3-coder");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
