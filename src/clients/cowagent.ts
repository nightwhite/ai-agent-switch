import { join } from "node:path";
import { BaseClientAdapter } from "./base";
import type { ApplyClientConfigInput, ApplyClientSlotsInput, ClientCurrentState, ClientId, PatchPlan } from "./types";
import { parseJsonObject, readTextIfExists, recordAt, stringifyJson } from "./utils";
import { normalizeProviderType, resolveModelType, type ProviderProfile, type ProviderType } from "../config/schema";

type CowAgentProviderFields = {
  botType: string;
  apiBaseKey?: string | undefined;
  apiKeyKey?: string | undefined;
  expectedApiKeyEnv?: string | undefined;
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
    const fields = cowAgentProviderFields(resolveModelType(input.provider, input.modelId));
    if (fields.apiBaseKey && !input.provider.baseUrl) {
      throw new Error(`CowAgent requires a baseUrl for provider ${input.provider.id}`);
    }

    const before = await readTextIfExists(this.configPath);
    const config = parseJsonObject(before);
    config.model = input.modelId;
    config.bot_type = fields.botType;
    if (fields.apiBaseKey) config[fields.apiBaseKey] = input.provider.baseUrl;
    if (fields.apiKeyKey) config[fields.apiKeyKey] = cowAgentApiKey(input.provider, fields);

    const aiAgentSwitch = recordAt(config, "ai_agent_switch");
    aiAgentSwitch.provider = input.provider.id;
    aiAgentSwitch.model = input.modelId;

    const file = before === undefined
      ? { path: this.configPath, after: stringifyJson(config) }
      : { path: this.configPath, before, after: stringifyJson(config) };
    return { clientId: this.id, summary: `Switch CowAgent to ${input.provider.id}/${input.modelId}`, files: [file] };
  }

  async planApplySlots(input: ApplyClientSlotsInput): Promise<PatchPlan> {
    const main = input.slots.find((slot) => slot.slot === "main");
    if (!main) throw new Error("CowAgent requires main slot");
    const fields = cowAgentProviderFields(resolveModelType(main.provider, main.modelId));
    if (fields.apiBaseKey && !main.provider.baseUrl) {
      throw new Error(`CowAgent requires a baseUrl for provider ${main.provider.id}`);
    }

    const before = await readTextIfExists(this.configPath);
    const config = parseJsonObject(before);
    config.model = main.modelId;
    config.bot_type = fields.botType;
    if (fields.apiBaseKey) config[fields.apiBaseKey] = main.provider.baseUrl;
    if (fields.apiKeyKey) config[fields.apiKeyKey] = cowAgentApiKey(main.provider, fields);

    const aiAgentSwitch = recordAt(config, "ai_agent_switch");
    aiAgentSwitch.provider = main.provider.id;
    aiAgentSwitch.model = main.modelId;
    const slots = recordAt(aiAgentSwitch, "slots");
    for (const slot of input.slots) {
      slots[slot.slot] = {
        provider: slot.provider.id,
        model: slot.modelId,
      };
    }

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
}

function cowAgentProviderFields(type: ProviderType): CowAgentProviderFields {
  switch (normalizeProviderType(type)) {
    case "anthropic":
      throw new Error("CowAgent requires an OpenAI Chat-compatible provider; Anthropic providers are not supported");
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

function cowAgentApiKey(provider: ProviderProfile, fields: CowAgentProviderFields): string | undefined {
  if (provider.apiKey?.kind === "inline") return provider.apiKey.value;
  const envName = provider.apiKeyEnv ?? (provider.apiKey?.kind === "env" ? provider.apiKey.name : undefined);
  if (!envName) return undefined;
  if (envName !== fields.expectedApiKeyEnv) {
    throw new Error(`CowAgent reads ${fields.expectedApiKeyEnv} for this provider type, but provider ${provider.id} uses ${envName}`);
  }
  return undefined;
}
