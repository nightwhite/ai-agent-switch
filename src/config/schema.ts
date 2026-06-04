import { z } from "zod";

export const providerTypes = [
  "openai-responses",
  "openai-chat-compatible",
  "openai",
  "anthropic",
  "gemini",
  "openai-compatible",
  "openrouter",
  "dashscope",
  "deepseek",
  "moonshot",
  "siliconflow",
  "ollama",
  "lmstudio",
  "custom",
] as const;

export type ProviderType = (typeof providerTypes)[number];

export const modelApiModes = [
  "chat_completions",
  "openai_compatible",
  "codex_responses",
  "anthropic_messages",
  "image_generation",
  "video_generation",
  "audio_transcriptions",
  "audio_speech",
  "embeddings",
] as const;

export type ModelApiMode = (typeof modelApiModes)[number];

export const modelKinds = [
  "llm",
  "vision",
  "image_generation",
  "video_generation",
  "asr",
  "tts",
  "embedding",
] as const;

export type ModelKind = (typeof modelKinds)[number];

export const selectableProviderTypes = [
  "openai-responses",
  "openai-chat-compatible",
  "anthropic",
  "gemini",
  "openrouter",
  "dashscope",
  "deepseek",
  "moonshot",
  "siliconflow",
  "ollama",
  "lmstudio",
  "custom",
] as const satisfies readonly ProviderType[];

export const providerTypeLabels: Record<ProviderType, string> = {
  "openai-responses": "OpenAI Responses API",
  "openai-chat-compatible": "OpenAI Chat Completions compatible",
  openai: "OpenAI Responses API (legacy alias)",
  anthropic: "Anthropic native API",
  gemini: "Gemini native API",
  "openai-compatible": "OpenAI Chat Completions compatible (legacy alias)",
  openrouter: "OpenRouter provider",
  dashscope: "DashScope provider",
  deepseek: "DeepSeek provider",
  moonshot: "Moonshot/Kimi provider",
  siliconflow: "SiliconFlow provider",
  ollama: "Ollama local provider",
  lmstudio: "LM Studio local provider",
  custom: "Custom provider",
};

export function normalizeProviderType(type: ProviderType): ProviderType {
  if (type === "openai") return "openai-responses";
  if (type === "openai-compatible") return "openai-chat-compatible";
  return type;
}

export function providerTypeForModelApiMode(mode: ModelApiMode): ProviderType | undefined {
  switch (mode) {
    case "chat_completions":
    case "openai_compatible":
      return "openai-chat-compatible";
    case "codex_responses":
      return "openai-responses";
    case "anthropic_messages":
      return "anthropic";
    case "image_generation":
    case "video_generation":
    case "audio_transcriptions":
    case "audio_speech":
    case "embeddings":
      return undefined;
    default:
      throw new Error(`Unsupported model API mode: ${String(mode)}`);
  }
}

export type SecretRef =
  | { kind: "env"; name: string }
  | { kind: "inline"; value: string };

export type ModelProfile = {
  id: string;
  name?: string | undefined;
  type?: ProviderType | undefined;
  apiMode?: ModelApiMode | undefined;
  kind?: ModelKind | undefined;
  contextWindow?: number | undefined;
  maxTokens?: number | undefined;
  capabilities?: string[] | undefined;
};

export type ProviderProfile = {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string | undefined;
  apiKeyEnv?: string | undefined;
  apiKey?: SecretRef | undefined;
  models: ModelProfile[];
  defaultModel?: string | undefined;
  headers?: Record<string, string> | undefined;
  params?: Record<string, unknown> | undefined;
};

export type ClientProfile = {
  enabled?: boolean | undefined;
  configPath?: string | undefined;
};

export type ProxyRetryConfig = {
  enabled: boolean;
  maxAttempts: number;
};

export type ProxyFailoverConfig = {
  enabled: boolean;
  strategy: "ordered";
};

export type ProxyConfig = {
  enabled: boolean;
  host: string;
  port: number;
  upstreamProxy?: string | undefined;
  retry: ProxyRetryConfig;
  failover: ProxyFailoverConfig;
};

export type RouteCandidate = {
  providerId: string;
  modelId: string;
};

export type RouteConfig = {
  candidates: RouteCandidate[];
};

export type RoutesConfig = {
  default?: RouteConfig | undefined;
};

export type AiAgentSwitchConfig = {
  version: 1;
  clients: Record<string, ClientProfile>;
  providers: Record<string, ProviderProfile>;
  routes: RoutesConfig;
  proxy: ProxyConfig;
  ui: {
    theme: string;
  };
};

export type ValidationResult = {
  ok: boolean;
  issues: string[];
};

export const secretRefSchema: z.ZodType<SecretRef> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("env"), name: z.string().min(1) }),
  z.object({ kind: z.literal("inline"), value: z.string().min(1) }),
]);

export const modelProfileSchema: z.ZodType<ModelProfile> = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  type: z.enum(providerTypes).optional(),
  apiMode: z.enum(modelApiModes).optional(),
  kind: z.enum(modelKinds).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  capabilities: z.array(z.string()).optional(),
});

export function resolveModelProfile(provider: ProviderProfile, modelId: string): ModelProfile | undefined {
  return provider.models.find((item) => item.id === modelId);
}

export function resolveModelType(provider: ProviderProfile, modelId: string): ProviderType {
  const model = resolveModelProfile(provider, modelId);
  return model?.type ?? provider.type;
}

export const providerProfileSchema: z.ZodType<ProviderProfile> = z.object({
  id: z.string().min(1).regex(/^[a-zA-Z0-9._-]+$/, "provider id can only contain letters, numbers, dot, underscore, and dash"),
  name: z.string().min(1),
  type: z.enum(providerTypes),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().min(1).optional(),
  apiKey: secretRefSchema.optional(),
  models: z.array(modelProfileSchema).min(1),
  defaultModel: z.string().min(1).optional(),
  headers: z.record(z.string()).optional(),
  params: z.record(z.unknown()).optional(),
});

export const routeCandidateSchema: z.ZodType<RouteCandidate> = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
});

export const routesConfigSchema: z.ZodType<RoutesConfig> = z.object({
  default: z.object({
    candidates: z.array(routeCandidateSchema),
  }).optional(),
});

export const aiAgentSwitchConfigSchema: z.ZodType<AiAgentSwitchConfig> = z.object({
  version: z.literal(1),
  clients: z.record(
    z.object({
      enabled: z.boolean().optional(),
      configPath: z.string().min(1).optional(),
    }),
  ),
  providers: z.record(providerProfileSchema),
  routes: routesConfigSchema,
  proxy: z.object({
    enabled: z.boolean(),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    upstreamProxy: z.string().url().optional(),
    retry: z.object({
      enabled: z.boolean(),
      maxAttempts: z.number().int().min(1).max(10),
    }),
    failover: z.object({
      enabled: z.boolean(),
      strategy: z.literal("ordered"),
    }),
  }),
  ui: z.object({
    theme: z.string().min(1),
  }),
});

export function createDefaultConfig(): AiAgentSwitchConfig {
  return {
    version: 1,
    clients: {},
    providers: {},
    routes: {},
    proxy: {
      enabled: false,
      host: "127.0.0.1",
      port: 17890,
      upstreamProxy: "http://127.0.0.1:7890",
      retry: {
        enabled: true,
        maxAttempts: 3,
      },
      failover: {
        enabled: true,
        strategy: "ordered",
      },
    },
    ui: {
      theme: "default",
    },
  };
}
