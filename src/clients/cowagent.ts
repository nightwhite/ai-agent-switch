import { join } from "node:path";
import { BaseClientAdapter } from "./base";
import type { ApplyClientConfigInput, ApplyClientSlotsInput, ClientCurrentState, ClientId, PatchPlan } from "./types";
import { parseJsonObject, readTextIfExists, recordAt, stringifyJson } from "./utils";
import { normalizeProviderType, resolveModelProfile, resolveModelType, type ModelKind, type ProviderProfile, type ProviderType } from "../config/schema";

type CowAgentProviderFields = {
  botType: string;
  apiBaseKey?: string | undefined;
  apiKeyKey?: string | undefined;
  expectedApiKeyEnv?: string | undefined;
  acceptedApiKeyEnvs?: string[] | undefined;
};

type CowAgentCapabilityProvider =
  | "claudeAPI"
  | "openai"
  | "gemini"
  | "dashscope"
  | "doubao"
  | "zhipu"
  | "moonshot"
  | "minimax"
  | "mimo"
  | "linkai";

type CowAgentCapabilityConfig = {
  provider: CowAgentCapabilityProvider;
  modelId: string;
  fields: CowAgentProviderFields;
};

type CowAgentLiveProvider = {
  providerId: string;
  apiKey?: string | undefined;
  apiBase?: string | undefined;
};

type CowAgentLiveCapability = {
  capability: string;
  providerId: string;
  model: string;
};

type CowAgentLiveApply = {
  providers: CowAgentLiveProvider[];
  capabilities: CowAgentLiveCapability[];
};

export class CowAgentAdapter extends BaseClientAdapter {
  id: ClientId = "cowagent";
  displayName = "CowAgent";
  configPath: string;
  protected override commandNames = ["cow"];

  constructor(homeDir: string) {
    super();
    const cowAgentHome = process.env.COWAGENT_HOME ?? join(homeDir, "CowAgent");
    this.configPath = join(cowAgentHome, "config.json");
  }

  async readConfig(): Promise<unknown> {
    return parseJsonObject(await readTextIfExists(this.configPath));
  }

  async planApply(input: ApplyClientConfigInput): Promise<PatchPlan> {
    const before = await readTextIfExists(this.configPath);
    const config = parseJsonObject(before);
    applyCowAgentMain(config, input.provider, input.modelId);

    const aiAgentSwitch = recordAt(config, "ai_agent_switch");
    aiAgentSwitch.provider = input.provider.id;
    aiAgentSwitch.model = input.modelId;
    aiAgentSwitch.live_apply = buildCowAgentLiveApply([{ slot: "main", provider: input.provider, modelId: input.modelId }]);

    const file = before === undefined
      ? { path: this.configPath, after: stringifyJson(config) }
      : { path: this.configPath, before, after: stringifyJson(config) };
    return { clientId: this.id, summary: `Switch CowAgent to ${input.provider.id}/${input.modelId}`, files: [file] };
  }

  async planApplySlots(input: ApplyClientSlotsInput): Promise<PatchPlan> {
    const main = input.slots.find((slot) => slot.slot === "main");
    if (!main) throw new Error("CowAgent requires main slot");

    const before = await readTextIfExists(this.configPath);
    const config = parseJsonObject(before);
    applyCowAgentMain(config, main.provider, main.modelId);

    const aiAgentSwitch = recordAt(config, "ai_agent_switch");
    aiAgentSwitch.provider = main.provider.id;
    aiAgentSwitch.model = main.modelId;
    const slots = recordAt(aiAgentSwitch, "slots");
    for (const slot of input.slots) {
      slots[slot.slot] = {
        provider: slot.provider.id,
        model: slot.modelId,
      };
      applyCowAgentCapabilitySlot(config, slot.slot, slot.provider, slot.modelId);
    }
    aiAgentSwitch.live_apply = buildCowAgentLiveApply(input.slots);

    const file = before === undefined
      ? { path: this.configPath, after: stringifyJson(config) }
      : { path: this.configPath, before, after: stringifyJson(config) };
    return { clientId: this.id, summary: `Configure CowAgent model slots for ${main.provider.id}/${main.modelId}`, files: [file] };
  }

  async getCurrent(): Promise<ClientCurrentState> {
    const config = parseJsonObject(await readTextIfExists(this.configPath));
    const aiAgentSwitch = config.ai_agent_switch && typeof config.ai_agent_switch === "object" && !Array.isArray(config.ai_agent_switch)
      ? config.ai_agent_switch as Record<string, unknown>
      : {};
    return {
      clientId: this.id,
      providerId: typeof aiAgentSwitch.provider === "string" ? aiAgentSwitch.provider : undefined,
      modelId: typeof aiAgentSwitch.model === "string" ? aiAgentSwitch.model : typeof config.model === "string" ? config.model : undefined,
      configPath: this.configPath,
    };
  }

  override async apply(plan: PatchPlan): Promise<void> {
    if (process.env.AI_AGENT_SWITCH_COWAGENT_LIVE_APPLY === "required") {
      const config = parseJsonObject(plan.files.find((file) => file.path === this.configPath)?.after ?? await readTextIfExists(this.configPath));
      await applyCowAgentLiveConfig(config);
    }
    await super.apply(plan);
  }
}

function applyCowAgentMain(config: Record<string, unknown>, provider: ProviderProfile, modelId: string): void {
  const fields = cowAgentProviderFields(resolveModelType(provider, modelId));
  if (fields.apiBaseKey && !provider.baseUrl) {
    throw new Error(`CowAgent requires a baseUrl for provider ${provider.id}`);
  }

  config.model = modelId;
  config.bot_type = fields.botType;
  const apiBase = cowAgentApiBase(provider, fields);
  if (fields.apiBaseKey) config[fields.apiBaseKey] = apiBase;
  if (fields.apiKeyKey) {
    const apiKey = cowAgentApiKey(provider, fields);
    if (apiKey !== undefined) config[fields.apiKeyKey] = apiKey;
  }
}

function applyCowAgentCapabilitySlot(
  config: Record<string, unknown>,
  slot: string,
  provider: ProviderProfile,
  modelId: string,
): void {
  if (slot === "main") return;
  assertCowAgentSlotModelKind(slot, resolveModelProfile(provider, modelId)?.kind);
  const capability = cowAgentCapabilityConfig(provider, modelId);

  if (slot === "vision") {
    assertCowAgentCapabilityProvider(slot, capability.provider, ["claudeAPI", "openai", "gemini", "dashscope", "doubao", "zhipu", "moonshot", "minimax", "mimo", "linkai"]);
    const vision = recordAt(recordAt(config, "tools"), "vision");
    vision.provider = capability.provider;
    vision.model = capability.modelId;
    applyCowAgentCapabilityCredential(config, provider, capability.fields);
    return;
  }

  if (slot === "image") {
    assertCowAgentCapabilityProvider(slot, capability.provider, ["openai", "gemini", "dashscope", "doubao", "minimax", "linkai"]);
    const image = recordAt(recordAt(config, "skills"), "image-generation");
    image.provider = capability.provider;
    image.model = capability.modelId;
    applyCowAgentCapabilityCredential(config, provider, capability.fields);
    return;
  }

  if (slot === "asr") {
    assertCowAgentCapabilityProvider(slot, capability.provider, ["openai", "dashscope", "zhipu", "linkai"]);
    config.voice_to_text = capability.provider;
    config.voice_to_text_model = capability.modelId;
    applyCowAgentCapabilityCredential(config, provider, capability.fields);
    return;
  }

  if (slot === "tts") {
    assertCowAgentCapabilityProvider(slot, capability.provider, ["openai", "dashscope", "zhipu", "minimax", "mimo", "linkai"]);
    config.text_to_voice = capability.provider;
    config.text_to_voice_model = capability.modelId;
    config.tts_voice_id = "";
    applyCowAgentCapabilityCredential(config, provider, capability.fields);
    return;
  }

  if (slot === "embedding") {
    assertCowAgentCapabilityProvider(slot, capability.provider, ["openai", "dashscope", "doubao", "zhipu", "linkai"]);
    config.embedding_provider = capability.provider;
    config.embedding_model = capability.modelId;
    applyCowAgentCapabilityCredential(config, provider, capability.fields);
  }
}

function assertCowAgentSlotModelKind(slot: string, kind: ModelKind | undefined): void {
  const allowed = cowAgentSlotModelKinds(slot);
  if (allowed.length === 0) return;
  if (!kind) {
    throw new Error(`CowAgent slot ${slot} requires explicit model kind ${allowed.join(" or ")}`);
  }
  if (allowed.includes(kind)) return;
  throw new Error(`CowAgent slot ${slot} requires model kind ${allowed.join(" or ")}, got ${kind}`);
}

function cowAgentSlotModelKinds(slot: string): ModelKind[] {
  switch (slot) {
    case "vision":
      return ["llm", "vision"];
    case "image":
      return ["image_generation"];
    case "asr":
      return ["asr"];
    case "tts":
      return ["tts"];
    case "embedding":
      return ["embedding"];
    default:
      return [];
  }
}

function cowAgentCapabilityConfig(provider: ProviderProfile, modelId: string): CowAgentCapabilityConfig {
  const providerFields = cowAgentProviderFields(resolveModelType(provider, modelId));
  if (providerFields.botType === "openai") {
    return {
      provider: "openai",
      modelId,
      fields: providerFields,
    };
  }
  if (providerFields.botType === "claudeAPI") {
    return {
      provider: "claudeAPI",
      modelId,
      fields: providerFields,
    };
  }
  const capabilityProvider = cowAgentCapabilityProvider(modelId);
  return {
    provider: capabilityProvider,
    modelId,
    fields: cowAgentCapabilityProviderFields(capabilityProvider),
  };
}

function cowAgentCapabilityProvider(modelId: string): CowAgentCapabilityProvider {
  const model = modelId.toLowerCase();
  if (model.startsWith("qwen") || model === "text-embedding-v4") return "dashscope";
  if (model.startsWith("claude-")) return "claudeAPI";
  if (model.startsWith("gemini-") || model.startsWith("nano-banana")) return "gemini";
  if (model.startsWith("gpt-") || model.startsWith("o1-") || model.startsWith("o3-") || model.startsWith("o4-") || model.startsWith("chatgpt-") || model.startsWith("text-embedding-3-") || model.startsWith("whisper-")) return "openai";
  if (model.startsWith("glm-") || model === "embedding-3") return "zhipu";
  if (model.startsWith("kimi-") || model.startsWith("moonshot-")) return "moonshot";
  if (model.startsWith("doubao-") || model.startsWith("seedream")) return "doubao";
  if (model.startsWith("minimax") || model.startsWith("abab") || model === "image-01") return "minimax";
  if (model.startsWith("mimo-")) return "mimo";
  if (model.startsWith("linkai-")) return "linkai";
  throw new Error(`CowAgent cannot infer capability provider for model ${modelId}`);
}

function assertCowAgentCapabilityProvider(slot: string, provider: CowAgentCapabilityProvider, allowed: CowAgentCapabilityProvider[]): void {
  if (!allowed.includes(provider)) {
    throw new Error(`CowAgent slot ${slot} does not support ${provider} model providers`);
  }
}

function applyCowAgentCapabilityCredential(
  config: Record<string, unknown>,
  provider: ProviderProfile,
  fields: CowAgentProviderFields,
): void {
  const apiBase = cowAgentApiBase(provider, fields);
  if (fields.apiBaseKey && apiBase) config[fields.apiBaseKey] = apiBase;
  if (!fields.apiKeyKey) return;

  const apiKey = cowAgentApiKeyForCapability(provider, fields);
  if (apiKey !== undefined) config[fields.apiKeyKey] = apiKey;
}

function cowAgentCapabilityProviderFields(provider: CowAgentCapabilityProvider): CowAgentProviderFields {
  switch (provider) {
    case "claudeAPI":
      return {
        botType: "claudeAPI",
        apiBaseKey: "claude_api_base",
        apiKeyKey: "claude_api_key",
        expectedApiKeyEnv: "CLAUDE_API_KEY",
        acceptedApiKeyEnvs: ["OPEN_AI_API_KEY", "AGENT_MODEL_APIKEY"],
      };
    case "openai":
      return { botType: "openai", apiBaseKey: "open_ai_api_base", apiKeyKey: "open_ai_api_key", expectedApiKeyEnv: "OPEN_AI_API_KEY" };
    case "gemini":
      return { botType: "gemini", apiBaseKey: "gemini_api_base", apiKeyKey: "gemini_api_key", expectedApiKeyEnv: "GEMINI_API_KEY" };
    case "dashscope":
      return { botType: "dashscope", apiBaseKey: "dashscope_api_base", apiKeyKey: "dashscope_api_key", expectedApiKeyEnv: "DASHSCOPE_API_KEY" };
    case "doubao":
      return { botType: "doubao", apiBaseKey: "ark_base_url", apiKeyKey: "ark_api_key", expectedApiKeyEnv: "ARK_API_KEY" };
    case "zhipu":
      return { botType: "zhipu", apiBaseKey: "zhipu_ai_api_base", apiKeyKey: "zhipu_ai_api_key", expectedApiKeyEnv: "ZHIPU_AI_API_KEY" };
    case "moonshot":
      return { botType: "moonshot", apiBaseKey: "moonshot_base_url", apiKeyKey: "moonshot_api_key", expectedApiKeyEnv: "MOONSHOT_API_KEY" };
    case "minimax":
      return { botType: "minimax", apiBaseKey: "minimax_api_base", apiKeyKey: "minimax_api_key", expectedApiKeyEnv: "MINIMAX_API_KEY" };
    case "mimo":
      return { botType: "mimo", apiBaseKey: "mimo_api_base", apiKeyKey: "mimo_api_key", expectedApiKeyEnv: "MIMO_API_KEY" };
    case "linkai":
      return { botType: "linkai", apiBaseKey: "linkai_api_base", apiKeyKey: "linkai_api_key", expectedApiKeyEnv: "LINKAI_API_KEY" };
  }
}

function cowAgentProviderFields(type: ProviderType): CowAgentProviderFields {
  switch (normalizeProviderType(type)) {
    case "anthropic":
      return {
        botType: "claudeAPI",
        apiBaseKey: "claude_api_base",
        apiKeyKey: "claude_api_key",
        expectedApiKeyEnv: "CLAUDE_API_KEY",
        acceptedApiKeyEnvs: ["OPEN_AI_API_KEY", "AGENT_MODEL_APIKEY"],
      };
    case "gemini":
      return {
        botType: "gemini",
        apiBaseKey: "gemini_api_base",
        apiKeyKey: "gemini_api_key",
        expectedApiKeyEnv: "GEMINI_API_KEY",
      };
    case "deepseek":
      return {
        botType: "deepseek",
        apiBaseKey: "deepseek_api_base",
        apiKeyKey: "deepseek_api_key",
        expectedApiKeyEnv: "DEEPSEEK_API_KEY",
      };
    case "moonshot":
      return {
        botType: "moonshot",
        apiBaseKey: "moonshot_base_url",
        apiKeyKey: "moonshot_api_key",
        expectedApiKeyEnv: "MOONSHOT_API_KEY",
      };
    case "dashscope":
      return {
        botType: "dashscope",
        apiKeyKey: "dashscope_api_key",
        expectedApiKeyEnv: "DASHSCOPE_API_KEY",
      };
    case "openai-chat-compatible":
    case "openrouter":
    case "siliconflow":
    case "lmstudio":
    case "custom":
      return {
        botType: "openai",
        apiBaseKey: "open_ai_api_base",
        apiKeyKey: "open_ai_api_key",
        expectedApiKeyEnv: "OPEN_AI_API_KEY",
      };
    case "openai-responses":
      throw new Error("CowAgent requires an OpenAI Chat-compatible provider; OpenAI Responses providers are not supported");
    case "ollama":
      throw new Error("CowAgent does not support Ollama providers");
    default:
      throw new Error(`Unsupported CowAgent provider type: ${type}`);
  }
}

function buildCowAgentLiveApply(slots: ApplyClientSlotsInput["slots"]): CowAgentLiveApply {
  const providers = new Map<string, CowAgentLiveProvider>();
  const capabilities: CowAgentLiveCapability[] = [];
  for (const slot of slots) {
    const fields = slot.slot === "main"
      ? cowAgentProviderFields(resolveModelType(slot.provider, slot.modelId))
      : cowAgentCapabilityConfig(slot.provider, slot.modelId).fields;
    const providerId = slot.slot === "main"
      ? fields.botType
      : cowAgentCapabilityConfig(slot.provider, slot.modelId).provider;

    if (!providers.has(providerId)) {
      providers.set(providerId, {
        providerId,
        apiKey: cowAgentApiKeyForCapability(slot.provider, fields) ?? process.env[cowAgentNativeApiKeyEnv(providerId)] ?? "",
        apiBase: cowAgentApiBase(slot.provider, fields),
      });
    }

    capabilities.push({
      capability: cowAgentCapabilityName(slot.slot),
      providerId,
      model: slot.modelId,
    });
  }
  return { providers: [...providers.values()], capabilities };
}

function cowAgentApiBase(provider: ProviderProfile, fields: CowAgentProviderFields): string | undefined {
  const baseUrl = provider.baseUrl?.trim();
  if (!fields.apiBaseKey || !baseUrl) return undefined;
  if (fields.botType !== "claudeAPI" || !isAIProxyProvider(provider, baseUrl)) return baseUrl;
  return normalizeAIProxyAnthropicBaseUrl(baseUrl);
}

function isAIProxyProvider(provider: ProviderProfile, baseUrl: string): boolean {
  if (provider.id === "aiproxy" || provider.id.startsWith("aiproxy-")) return true;
  try {
    return new URL(baseUrl).hostname.toLowerCase().includes("aiproxy");
  } catch {
    return false;
  }
}

function normalizeAIProxyAnthropicBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/v1" || path === "/anthropic") {
    url.pathname = "/anthropic";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  }
  return baseUrl;
}

function cowAgentCapabilityName(slot: string): string {
  return slot === "main" ? "chat" : slot;
}

function cowAgentLiveApplyFromConfig(config: Record<string, unknown>): CowAgentLiveApply {
  const aiAgentSwitch = recordOrUndefined(config.ai_agent_switch);
  const liveApply = recordOrUndefined(aiAgentSwitch?.live_apply);
  const providers = Array.isArray(liveApply?.providers)
    ? liveApply.providers.flatMap((item) => {
        const provider = recordOrUndefined(item);
        const providerId = stringAt(provider, "providerId");
        if (!providerId) return [];
        return [{
          providerId,
          apiKey: stringAt(provider, "apiKey") || process.env[cowAgentNativeApiKeyEnv(providerId)] || "",
          apiBase: stringAt(provider, "apiBase") || undefined,
        }];
      })
    : [];
  const capabilities = Array.isArray(liveApply?.capabilities)
    ? liveApply.capabilities.flatMap((item) => {
        const capability = recordOrUndefined(item);
        const name = stringAt(capability, "capability");
        const providerId = stringAt(capability, "providerId");
        const model = stringAt(capability, "model");
        if (!name || !providerId || !model) return [];
        return [{ capability: name, providerId, model }];
      })
    : [];
  if (providers.length === 0 || capabilities.length === 0) {
    throw new Error("CowAgent live apply metadata is missing; run client configure again");
  }
  return { providers, capabilities };
}

async function applyCowAgentLiveConfig(config: Record<string, unknown>): Promise<void> {
  const liveApply = cowAgentLiveApplyFromConfig(config);
  const client = new CowAgentLiveClient();
  await client.login();
  for (const provider of liveApply.providers) {
    await client.postModels({
      action: "set_provider",
      provider_id: provider.providerId,
      api_key: provider.apiKey,
      api_base: provider.apiBase,
    });
  }
  for (const capability of liveApply.capabilities) {
    await client.postModels({
      action: "set_capability",
      capability: capability.capability,
      provider_id: capability.providerId,
      model: capability.model,
    });
  }
}

function cowAgentNativeApiKeyEnv(providerId: string): string {
  switch (providerId) {
    case "claudeAPI":
      return "CLAUDE_API_KEY";
    case "gemini":
      return "GEMINI_API_KEY";
    case "dashscope":
      return "DASHSCOPE_API_KEY";
    case "doubao":
      return "ARK_API_KEY";
    case "zhipu":
      return "ZHIPU_AI_API_KEY";
    case "moonshot":
      return "MOONSHOT_API_KEY";
    case "minimax":
      return "MINIMAX_API_KEY";
    case "mimo":
      return "MIMO_API_KEY";
    case "linkai":
      return "LINKAI_API_KEY";
    case "openai":
      return "OPEN_AI_API_KEY";
    default:
      return "";
  }
}

function stringAt(record: unknown, key: string): string {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "";
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function recordOrUndefined(record: unknown): Record<string, unknown> | undefined {
  if (!record || typeof record !== "object" || Array.isArray(record)) return undefined;
  return record as Record<string, unknown>;
}

class CowAgentLiveClient {
  private cookie = "";
  private readonly baseUrl: string;

  constructor() {
    const port = process.env.COWAGENT_WEB_PORT || process.env.AGENT_PORT || "9899";
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async login(): Promise<void> {
    const password = process.env.COWAGENT_WEB_PASSWORD ?? "";
    if (!password) return;
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const body = await response.json() as { status?: string; message?: string };
    if (!response.ok || body.status !== "success") {
      throw new Error(`CowAgent live apply login failed: ${body.message ?? response.statusText}`);
    }
    this.cookie = parseSetCookie(response.headers.get("set-cookie"));
  }

  async postModels(body: Record<string, unknown>): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/models`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { status?: string; message?: string };
    if (!response.ok || payload.status !== "success") {
      throw new Error(`CowAgent live apply failed: ${payload.message ?? response.statusText}`);
    }
  }
}

function parseSetCookie(value: string | null): string {
  if (!value) return "";
  return value.split(";", 1)[0] ?? "";
}

function cowAgentApiKeyForCapability(provider: ProviderProfile, fields: CowAgentProviderFields): string | undefined {
  if (provider.apiKey?.kind === "inline") return provider.apiKey.value;
  const envName = provider.apiKeyEnv ?? (provider.apiKey?.kind === "env" ? provider.apiKey.name : undefined);
  if (!envName) return undefined;
  if (envName === fields.expectedApiKeyEnv) return process.env[envName] || undefined;
  if (fields.acceptedApiKeyEnvs?.includes(envName)) return process.env[envName] || undefined;
  return process.env[envName] || undefined;
}

function cowAgentApiKey(provider: ProviderProfile, fields: CowAgentProviderFields): string | undefined {
  if (provider.apiKey?.kind === "inline") return provider.apiKey.value;
  const envName = provider.apiKeyEnv ?? (provider.apiKey?.kind === "env" ? provider.apiKey.name : undefined);
  if (!envName) return undefined;
  if (envName === fields.expectedApiKeyEnv) return process.env[envName] || undefined;
  if (envName !== fields.expectedApiKeyEnv) {
    if (fields.acceptedApiKeyEnvs?.includes(envName)) return process.env[envName] || undefined;
    const allowed = [fields.expectedApiKeyEnv, ...(fields.acceptedApiKeyEnvs ?? [])].join(" or ");
    throw new Error(`CowAgent reads ${allowed} for this provider type, but provider ${provider.id} uses ${envName}`);
  }
  return undefined;
}
