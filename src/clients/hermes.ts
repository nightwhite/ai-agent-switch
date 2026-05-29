import { join } from "node:path";
import { BaseClientAdapter } from "./base";
import type { ApplyClientConfigInput, ApplyClientSlotsInput, ClientCurrentState, ClientId, PatchPlan, PatchFile } from "./types";
import { envKeyForProvider, parseYamlObject, readTextIfExists, recordAt, stringifyYamlObject, writeEnvValue } from "./utils";
import { writeAtomic } from "../fs/atomic";
import { normalizeProviderType, resolveModelType, type ProviderType } from "../config/schema";

export class HermesAdapter extends BaseClientAdapter {
  id: ClientId = "hermes";
  displayName = "Hermes Agent";
  configPath: string;
  protected override commandNames = ["hermes"];
  private readonly envPath: string;

  constructor(homeDir: string) {
    super();
    const hermesHome = process.env.HERMES_HOME ?? join(homeDir, ".hermes");
    this.configPath = join(hermesHome, "config.yaml");
    this.envPath = join(hermesHome, ".env");
  }

  async readConfig(): Promise<unknown> {
    return parseYamlObject(await readTextIfExists(this.configPath));
  }

  async planApply(input: ApplyClientConfigInput): Promise<PatchPlan> {
    const before = await readTextIfExists(this.configPath);
    const config = parseYamlObject(before);
    const model = recordAt(config, "model");
    model.provider = input.provider.id;
    model.default = input.modelId;
    const modelType = resolveModelType(input.provider, input.modelId);
    const providers = recordAt(config, "providers");
    providers[input.provider.id] = {
      name: input.provider.name,
      base_url: hermesBaseUrl(modelType, input.provider.baseUrl),
      key_env: input.provider.apiKeyEnv ?? (input.provider.apiKey?.kind === "env" ? input.provider.apiKey.name : envKeyForProvider(input.provider.id)),
      transport: hermesTransport(modelType),
      default_model: input.provider.defaultModel ?? input.modelId,
      models: input.provider.models.map((model) => model.id),
    };

    const files: PatchFile[] = [
      before === undefined
        ? { path: this.configPath, after: stringifyYamlObject(config) }
        : { path: this.configPath, before, after: stringifyYamlObject(config) },
    ];

    if (input.provider.apiKey?.kind === "inline") {
      const envBefore = await readTextIfExists(this.envPath);
      const key = input.provider.apiKeyEnv ?? envKeyForProvider(input.provider.id);
      const assignment = `${key}=${JSON.stringify(input.provider.apiKey.value)}\n`;
      const envAfter = envBefore ? mergeEnv(envBefore, key, assignment.trimEnd()) : assignment;
      files.push(envBefore === undefined ? { path: this.envPath, after: envAfter } : { path: this.envPath, before: envBefore, after: envAfter });
    }

    return { clientId: this.id, summary: `Switch Hermes Agent to ${input.provider.id}/${input.modelId}`, files };
  }

  async planApplySlots(input: ApplyClientSlotsInput): Promise<PatchPlan> {
    if (input.slots.length !== 1 || input.slots[0]?.slot !== "main") {
      throw new Error("Hermes Agent currently supports only main model slot");
    }
    const slot = input.slots[0];
    return this.planApply({ provider: slot.provider, modelId: slot.modelId });
  }

  override async apply(plan: PatchPlan): Promise<void> {
    for (const file of plan.files) {
      if (file.path.endsWith(".env")) {
        const match = file.after.match(/^([^=]+)=(.*)$/m);
        if (match) {
          await writeEnvValue(file.path, match[1]!, JSON.parse(match[2]!));
          continue;
        }
      }
      await writeAtomic(file.path, file.after);
    }
  }

  async getCurrent(): Promise<ClientCurrentState> {
    const config = parseYamlObject(await readTextIfExists(this.configPath));
    const model = config.model && typeof config.model === "object" && !Array.isArray(config.model)
      ? config.model as Record<string, unknown>
      : {};
    return {
      clientId: this.id,
      providerId: typeof model.provider === "string" ? model.provider : undefined,
      modelId: typeof model.default === "string" ? model.default : undefined,
      configPath: this.configPath,
    };
  }
}

function hermesTransport(type: ProviderType): "openai_chat" | "anthropic_messages" | "codex_responses" {
  const normalized = normalizeProviderType(type);
  if (normalized === "anthropic") return "anthropic_messages";
  if (normalized === "openai-responses") return "codex_responses";
  return "openai_chat";
}

function hermesBaseUrl(type: ProviderType, baseUrl: string | undefined): string | undefined {
  if (!baseUrl || normalizeProviderType(type) !== "anthropic") return baseUrl;
  return baseUrl.replace(/\/v1\/?$/, "");
}

function mergeEnv(text: string, key: string, assignment: string): string {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const next = lines.some((line) => line.startsWith(`${key}=`))
    ? lines.map((line) => (line.startsWith(`${key}=`) ? assignment : line))
    : [...lines, assignment];
  return `${next.join("\n")}\n`;
}
