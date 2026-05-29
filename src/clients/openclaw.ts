import { join } from "node:path";
import { BaseClientAdapter } from "./base";
import type { ApplyClientConfigInput, ApplyClientSlotsInput, ClientCurrentState, ClientId, PatchPlan } from "./types";
import { parseJsoncObject, readTextIfExists, recordAt, stringifyJson } from "./utils";
import { normalizeProviderType, resolveModelType, type ModelProfile, type ProviderProfile, type ProviderType } from "../config/schema";

type OpenClawProviderApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "ollama";

export class OpenClawAdapter extends BaseClientAdapter {
  id: ClientId = "openclaw";
  displayName = "OpenClaw";
  configPath: string;
  protected override commandNames = ["openclaw"];

  constructor(homeDir: string) {
    super();
    const openclawHome = process.env.OPENCLAW_HOME ?? join(homeDir, ".openclaw");
    this.configPath = process.env.OPENCLAW_CONFIG_PATH ?? join(openclawHome, "openclaw.json");
  }

  async readConfig(): Promise<unknown> {
    return parseJsoncObject(await readTextIfExists(this.configPath));
  }

  async planApply(input: ApplyClientConfigInput): Promise<PatchPlan> {
    if (!input.provider.baseUrl) {
      throw new Error(`OpenClaw requires a baseUrl for provider ${input.provider.id}`);
    }
    const before = await readTextIfExists(this.configPath);
    const config = parseJsoncObject(before);
    const agents = recordAt(config, "agents");
    const defaults = recordAt(agents, "defaults");
    const model = recordAt(defaults, "model");
    model.primary = `${input.provider.id}/${input.modelId}`;
    const models = recordAt(config, "models");
    const providers = recordAt(models, "providers");
    const modelType = resolveModelType(input.provider, input.modelId);
    providers[input.provider.id] = {
      baseUrl: input.provider.baseUrl,
      apiKey: openClawApiKey(input.provider),
      api: openClawApi(modelType),
      models: input.provider.models.map((model) => openClawModel(model, input.provider.type)),
    };
    const file = before === undefined
      ? { path: this.configPath, after: stringifyJson(config) }
      : { path: this.configPath, before, after: stringifyJson(config) };
    return { clientId: this.id, summary: `Switch OpenClaw default model to ${input.provider.id}/${input.modelId}`, files: [file] };
  }

  async planApplySlots(input: ApplyClientSlotsInput): Promise<PatchPlan> {
    if (input.slots.length !== 1 || input.slots[0]?.slot !== "main") {
      throw new Error("OpenClaw currently supports only main model slot");
    }
    const slot = input.slots[0];
    return this.planApply({ provider: slot.provider, modelId: slot.modelId });
  }

  async getCurrent(): Promise<ClientCurrentState> {
    const config = parseJsoncObject(await readTextIfExists(this.configPath));
    const agents = config.agents && typeof config.agents === "object" ? config.agents as Record<string, unknown> : {};
    const defaults = agents.defaults && typeof agents.defaults === "object" ? agents.defaults as Record<string, unknown> : {};
    const model = defaults.model && typeof defaults.model === "object" ? defaults.model as Record<string, unknown> : {};
    const primary = typeof model.primary === "string" ? model.primary : undefined;
    const slash = primary?.indexOf("/") ?? -1;
    return {
      clientId: this.id,
      providerId: slash > 0 ? primary?.slice(0, slash) : undefined,
      modelId: slash > 0 ? primary?.slice(slash + 1) : primary,
      configPath: this.configPath,
    };
  }
}

function openClawApi(type: ProviderType): OpenClawProviderApi {
  switch (normalizeProviderType(type)) {
    case "anthropic":
      return "anthropic-messages";
    case "gemini":
      return "google-generative-ai";
    case "ollama":
      return "ollama";
    case "openai-responses":
      return "openai-responses";
    case "openai-chat-compatible":
    case "openrouter":
    case "dashscope":
    case "deepseek":
    case "moonshot":
    case "siliconflow":
    case "lmstudio":
      return "openai-completions";
    case "custom":
      throw new Error("OpenClaw requires a concrete provider type; use openai-chat-compatible, anthropic, gemini, or ollama");
    default:
      throw new Error(`Unsupported OpenClaw provider type: ${type}`);
  }
}

function openClawApiKey(provider: ProviderProfile): string | { source: "env"; provider: "default"; id: string } | undefined {
  const envName = provider.apiKeyEnv ?? (provider.apiKey?.kind === "env" ? provider.apiKey.name : undefined);
  if (envName) return { source: "env", provider: "default", id: envName };
  if (provider.apiKey?.kind === "inline") return provider.apiKey.value;
  return undefined;
}

function openClawModel(model: ModelProfile, providerType: ProviderType): Record<string, unknown> {
  return {
    id: model.id,
    name: model.name ?? model.id,
    api: openClawApi(model.type ?? providerType),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}
