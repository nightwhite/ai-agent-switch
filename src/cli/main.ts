#!/usr/bin/env bun
import { cac } from "cac";
import pc from "picocolors";
import { AiAgentSwitchApp } from "../core/app";
import {
  modelApiModes,
  providerTypeForModelApiMode,
  providerTypeLabels,
  selectableProviderTypes,
  type ModelApiMode,
  type ProviderProfile,
  type ProviderType,
} from "../config/schema";
import { parseClientId, printDoctor, printPatchPlan, printProviders, printStatus, printValidation } from "../shared/output";
import { confirm } from "../shared/prompt";
import { runTui } from "../tui/app";
import { proxyStatus, startProxy, startProxyDaemon, stopProxy } from "../proxy/server";
import { aiAgentSwitchJsonSchema } from "../config/json-schema";
import { completionScript } from "./completion";
import { getProviderPreset, listProviderPresets } from "../providers/presets";
import { packageVersion } from "./version";
import type { ClientSlotTarget } from "../clients/types";

const cli = cac("ai-agent-switch");
const app = new AiAgentSwitchApp();
type SelectableProviderType = (typeof selectableProviderTypes)[number];

cli.help();
cli.version(packageVersion());

if (process.argv.slice(2).length === 0) {
  await runTui(app);
  process.exit(0);
}

cli.command("status", "Show current status")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const status = await app.status();
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    printStatus(status);
  });

cli.command("doctor", "Check configuration and client status")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const report = await app.doctor();
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    printDoctor(report);
  });

cli.command("config <action>", "Configuration commands: path / validate / schema")
  .option("--json", "Output JSON")
  .action(async (action: string, options) => {
  if (action === "path") {
    console.log(await app.configPath());
    return;
  }
  if (action === "validate") {
    const result = await app.validateConfig();
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    printValidation(result);
    return;
  }
  if (action === "schema") {
    console.log(JSON.stringify(aiAgentSwitchJsonSchema(), null, 2));
    return;
  }
  throw new Error(`Unsupported config action: ${action}`);
});

cli.command("client <action> [client]", "Client commands: list / detect / show / use-proxy / configure")
  .option("--json", "Output JSON")
  .option("--dry-run", "Print the change plan without writing client config")
  .option("--client <client>", "Client id")
  .option("--slot <slot>", "Model slot, repeatable, format name=provider/model", { default: [] })
  .option("-y, --yes", "Skip interactive confirmation, but keep hard validation")
  .action(async (action: string, client: string | undefined, options) => {
    if (action === "list") {
      const clients = await app.listClients();
      if (options.json) {
        console.log(JSON.stringify(clients, null, 2));
        return;
      }
      for (const item of clients) {
        console.log(`${pc.cyan(item.id)} ${pc.dim(item.configPath)}`);
      }
      return;
    }
    if (action === "detect") {
      if (client) {
        const detection = await app.detectClient(parseClientId(client));
        if (options.json) {
          console.log(JSON.stringify(detection, null, 2));
          return;
        }
        console.log(`${detection.configExists ? pc.green("OK") : pc.yellow("MISS")} ${client} ${pc.dim(detection.configPath)}`);
        return;
      }
      const clients = await app.listClients();
      const detections = await app.detectClients();
      if (options.json) {
        console.log(JSON.stringify(detections, null, 2));
        return;
      }
      detections.forEach((detection, index) => {
        const item = clients[index];
        console.log(`${detection.configExists ? pc.green("OK") : pc.yellow("MISS")} ${item?.id ?? "unknown"} ${pc.dim(detection.configPath)}`);
      });
      return;
    }
    if (action === "show") {
      if (!client) throw new Error("Missing client");
      const id = parseClientId(client);
      console.log(JSON.stringify(await app.getClientCurrent(id), null, 2));
      return;
    }
    if (action === "use-proxy") {
      if (!client) throw new Error("Missing client");
      const clientId = parseClientId(client);
      const result = await app.useClientProxy({ clientId, yes: Boolean(options.yes) && !options.dryRun });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      printPatchPlan(result.plan);
      if (options.dryRun) {
        console.log(pc.yellow("dry-run: client config was not written"));
        return;
      }
      if (result.requiresConfirmation) {
        if (!(await confirm("Apply these configuration changes?"))) {
          console.log(pc.yellow("Canceled; client config was not written"));
          return;
        }
        await app.useClientProxy({ clientId, yes: true });
        console.log(pc.green("OK applied"));
        return;
      }
      console.log(pc.green("OK applied"));
      return;
    }
    if (action === "configure") {
      const clientId = parseClientId(stringOption(options.client ?? client, "client"));
      const slots = parseClientSlots(options.slot);
      const result = await app.configureClient({ clientId, slots, yes: Boolean(options.yes) && !options.dryRun });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      printPatchPlan(result.plan);
      if (options.dryRun) {
        console.log(pc.yellow("dry-run: client config was not written"));
        return;
      }
      if (result.requiresConfirmation) {
        if (!(await confirm("Apply these configuration changes?"))) {
          console.log(pc.yellow("Canceled; client config was not written"));
          return;
        }
        await app.configureClient({ clientId, slots, yes: true });
        console.log(pc.green("OK applied"));
        return;
      }
      console.log(pc.green("OK applied"));
      return;
    }
    throw new Error(`Unsupported client action: ${action}`);
  });

cli
  .command("provider <action> [id] [value]", "Provider commands: list / show / init / preset-list / preset-show / preset-add / add / edit / remove / test / model-add / model-remove / default-model")
  .option("--id <id>", "provider id")
  .option("--name <name>", "Display name")
  .option("--type <type>", `Provider type: ${selectableProviderTypes.map((type) => `${type} (${providerTypeLabels[type]})`).join(", ")}`)
  .option("--base-url <url>", "OpenAI-compatible base URL")
  .option("--api-key-env <name>", "API key environment variable name")
  .option("--api-key <key>", "Inline API key, not recommended")
  .option("--model <model>", "Model ID, repeatable; provider init requires modelId:apiMode", { default: [] })
  .option("--default-model <model>", "Provider default model")
  .option("--json", "Output JSON")
  .option("-y, --yes", "Skip confirmation")
  .action(async (action: string, id: string | undefined, value: string | undefined, options) => {
    if (action === "list") {
      const providers = await app.listProviders(true);
      if (options.json) {
        console.log(JSON.stringify(providers, null, 2));
        return;
      }
      printProviders(providers);
      return;
    }
    if (action === "preset-list") {
      const presets = listProviderPresets();
      if (options.json) {
        console.log(JSON.stringify(presets.map(({ toProvider: _toProvider, ...preset }) => preset), null, 2));
        return;
      }
      for (const preset of presets) {
        console.log(`${pc.cyan(preset.id)} ${preset.name} ${pc.dim(preset.baseUrl ?? "no baseUrl")}`);
        console.log(`  ${pc.dim("models:")} ${preset.models.join(", ")}`);
      }
      return;
    }
    if (action === "preset-show") {
      if (!id) throw new Error("Missing preset id");
      const preset = getProviderPreset(id);
      if (!preset) throw new Error(`Provider preset not found: ${id}`);
      const { toProvider: _toProvider, ...safePreset } = preset;
      console.log(JSON.stringify(safePreset, null, 2));
      return;
    }
    if (action === "preset-add") {
      if (!id) throw new Error("Missing preset id");
      const provider = await app.addProviderPreset(id, { apiKeyEnv: optionalString(options.apiKeyEnv) });
      if (options.json) {
        console.log(JSON.stringify(provider, null, 2));
        return;
      }
      console.log(`${pc.green("OK")} provider preset ${id} saved as ${provider.id}`);
      return;
    }
    if (action === "show") {
      if (!id) throw new Error("Missing provider id");
      const provider = (await app.listProviders(true)).find((item) => item.id === id);
      if (!provider) throw new Error(`Provider not found: ${id}`);
      console.log(JSON.stringify(provider, null, 2));
      return;
    }
    if (action === "add") {
      const provider = providerFromOptions(options);
      await app.addProvider(provider);
      console.log(`${pc.green("OK")} provider ${provider.id} saved`);
      return;
    }
    if (action === "init") {
      if (optionalString(options.apiKey)) {
        throw new Error("provider init does not support --api-key; use --api-key-env");
      }
      const provider = await app.initProvider({
        providerId: stringOption(options.id, "id"),
        providerName: stringOption(options.name, "name"),
        providerType: optionalString(options.type) ? parseProviderType(String(options.type), "type") : undefined,
        baseUrl: optionalString(options.baseUrl),
        apiKeyEnv: optionalString(options.apiKeyEnv),
        models: parseProviderInitModels(options.model),
        defaultModel: optionalString(options.defaultModel),
      });
      if (options.json) {
        console.log(JSON.stringify(provider, null, 2));
        return;
      }
      console.log(`${pc.green("OK")} provider ${provider.id} initialized`);
      return;
    }
    if (action === "model-add") {
      if (!id) throw new Error("Missing provider id");
      const model = stringOption(value ?? firstModelOption(options.model), "model");
      const provider = await app.addProviderModel(id, model);
      console.log(`${pc.green("OK")} provider ${provider.id} model added ${model}`);
      return;
    }
    if (action === "model-remove") {
      if (!id) throw new Error("Missing provider id");
      const model = stringOption(value ?? firstModelOption(options.model), "model");
      const provider = await app.removeProviderModel(id, model);
      console.log(`${pc.green("OK")} provider ${provider.id} model removed ${model}`);
      return;
    }
    if (action === "default-model") {
      if (!id) throw new Error("Missing provider id");
      const model = stringOption(value ?? optionalString(options.defaultModel), "default-model");
      const provider = await app.setProviderDefaultModel(id, model);
      console.log(`${pc.green("OK")} provider ${provider.id} default model ${model}`);
      return;
    }
    if (action === "edit") {
      if (!id) throw new Error("Missing provider id");
      const current = (await app.listProviders(false)).find((provider) => provider.id === id);
      if (!current) throw new Error(`Provider not found: ${id}`);
      const next = providerFromOptions({ ...options, id, name: options.name ?? current.name, type: options.type ?? current.type }, current);
      await app.addProvider(next);
      console.log(`${pc.green("OK")} provider ${id} updated`);
      return;
    }
    if (action === "remove") {
      if (!id) throw new Error("Missing provider id");
      if (!options.yes && !(await confirm(`Remove provider ${id}?`))) return;
      const removed = await app.removeProvider(id);
      console.log(removed ? `${pc.green("OK")} removed ${id}` : `${pc.yellow("MISS")} provider not found`);
      return;
    }
    if (action === "test") {
      if (!id) throw new Error("Missing provider id");
      printValidation(await app.testProvider(id));
      return;
    }
    throw new Error(`Unsupported provider action: ${action}`);
  });

cli.command("model <action>", "Model commands: list")
  .option("--json", "Output JSON")
  .action(async (action: string, options) => {
    if (action === "list") {
      const models = await app.listModelTargets();
      if (options.json) {
        console.log(JSON.stringify(models, null, 2));
        return;
      }
      if (models.length === 0) {
        console.log(pc.dim("No models yet. Add one with provider add or provider preset-add."));
        return;
      }
      for (const model of models) {
        const tags: string[] = [];
        if (model.isProviderDefault) tags.push("default");
        if (model.routeIndex !== undefined) tags.push(model.routeIndex === 0 ? "primary" : `fallback ${model.routeIndex}`);
        const suffix = tags.length > 0 ? ` ${pc.dim(`[${tags.join(", ")}]`)}` : "";
        console.log(`${pc.cyan(model.ref)} ${pc.dim(model.providerName)} ${pc.dim(model.providerType)}${suffix}`);
      }
      return;
    }
    throw new Error(`Unsupported model action: ${action}`);
  });

cli
  .command("switch", "Switch one client to a provider/model")
  .option("--client <client>", "Client id")
  .option("--provider <provider>", "Provider id")
  .option("--model <model>", "Model id; defaults to provider defaultModel")
  .option("--dry-run", "Print the change plan without writing client config")
  .option("--json", "Output JSON")
  .option("-y, --yes", "Skip interactive confirmation, but keep hard validation")
  .action(async (options) => {
    const clientId = parseClientId(stringOption(options.client, "client"));
    const providerId = stringOption(options.provider, "provider");
    const modelId = optionalString(options.model);
    const result = await app.switchClient({
      clientId,
      providerId,
      modelId,
      yes: Boolean(options.yes) && !options.dryRun,
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printPatchPlan(result.plan);
    if (options.dryRun) {
      console.log(pc.yellow("dry-run: client config was not written"));
      return;
    }
    if (result.requiresConfirmation) {
      if (!(await confirm("Apply these configuration changes?"))) {
        console.log(pc.yellow("Canceled; client config was not written"));
        return;
      }
      await app.switchClient({ clientId, providerId, modelId, yes: true });
      console.log(pc.green("OK applied"));
      return;
    }
    console.log(pc.green("OK applied"));
  });

cli
  .command("use <client> <target>", "Advanced: write native provider/model config directly, for example qwen openrouter/qwen/qwen3-coder")
  .option("--dry-run", "Print the change plan without writing client config")
  .option("--json", "Output JSON")
  .option("-y, --yes", "Skip interactive confirmation, but keep hard validation")
  .action(async (client: string, target: string, options) => {
    const result = await app.useClient({ clientId: parseClientId(client), target, yes: Boolean(options.yes) && !options.dryRun });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printPatchPlan(result.plan);
    if (options.dryRun) {
      console.log(pc.yellow("dry-run: client config was not written"));
      return;
    }
    if (result.requiresConfirmation) {
      if (!(await confirm("Apply these configuration changes?"))) {
        console.log(pc.yellow("Canceled; client config was not written"));
        return;
      }
      await app.useClient({ clientId: parseClientId(client), target, yes: true });
      console.log(pc.green("OK applied"));
      return;
    }
    console.log(pc.green("OK applied"));
  });

cli
  .command("use-all <target>", "Advanced: write native provider/model config directly to all supported clients")
  .option("--dry-run", "Print the change plan without writing client config")
  .option("--json", "Output JSON")
  .option("-y, --yes", "Skip interactive confirmation, but keep hard validation")
  .action(async (target: string, options) => {
    const result = await app.useAllClients({ target, yes: Boolean(options.yes) && !options.dryRun });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    for (const item of result.results) {
      switch (item.status) {
        case "planned":
        case "applied":
          console.log(`${item.status === "applied" ? pc.green("APPLIED") : pc.yellow("PLAN")} ${item.clientId}`);
          printPatchPlan(item.plan);
          break;
        case "skipped":
          console.log(`${pc.dim("SKIP")} ${item.clientId} ${item.reason}`);
          break;
        case "failed":
          console.log(`${pc.red("FAIL")} ${item.clientId} ${item.reason}`);
          break;
      }
    }

    if (!options.yes || options.dryRun) {
      console.log(pc.yellow("Nothing was written, or not all items were written. Use -y to apply all planned items."));
    }
  });

cli.command("current", "Show current provider/model for all clients").action(async () => {
  const status = await app.status();
  for (const client of status.clients) {
    console.log(`${pc.cyan(client.clientId)} ${client.providerId ?? "-"} ${client.modelId ?? "-"}`);
  }
});

cli.command("route <action> [target]", "Route commands: list / set-default / add-fallback / remove / clear")
  .option("--json", "Output JSON")
  .action(async (action: string, target: string | undefined, options) => {
    if (action === "list") {
      const route = (await app.loadConfig()).routes.default?.candidates ?? [];
      if (options.json) {
        console.log(JSON.stringify({ candidates: route }, null, 2));
        return;
      }
      if (route.length === 0) {
        console.log(pc.dim("Default route is not configured. The proxy will route by provider default model or first model."));
        return;
      }
      route.forEach((candidate, index) => {
        const prefix = index === 0 ? pc.green("primary") : pc.yellow(`fallback ${index}`);
        console.log(`${prefix} ${candidate.providerId}/${candidate.modelId}`);
      });
      return;
    }
    if (action === "set-default") {
      if (!target) throw new Error("Missing route target");
      const route = await app.setDefaultRoute(target);
      console.log(`${pc.green("OK")} default route ${formatRoute(route)}`);
      return;
    }
    if (action === "add-fallback") {
      if (!target) throw new Error("Missing route target");
      const route = await app.addRouteFallback(target);
      console.log(`${pc.green("OK")} default route ${formatRoute(route)}`);
      return;
    }
    if (action === "remove") {
      if (!target) throw new Error("Missing route target");
      const route = await app.removeRouteCandidate(target);
      console.log(`${pc.green("OK")} default route ${formatRoute(route)}`);
      return;
    }
    if (action === "clear") {
      await app.clearDefaultRoute();
      console.log(`${pc.green("OK")} default route cleared`);
      return;
    }
  throw new Error(`Unsupported route action: ${action}`);
  });

cli.command("completion <shell>", "Output shell completion: zsh / bash").action((shell: string) => {
  console.log(completionScript(shell));
});

cli.command("proxy <action>", "Proxy commands: start / stop / status / enable / disable / set")
  .option("--daemon", "Start proxy in the background")
  .option("--foreground", "Start proxy in the foreground")
  .option("--force", "Enable proxy config before starting")
  .option("--host <host>", "Proxy listen host")
  .option("--port <port>", "Proxy listen port")
  .option("--upstream-proxy <url>", "Upstream network proxy, for example http://127.0.0.1:7890")
  .option("--retry <enabled>", "Enable retry: true / false")
  .option("--max-attempts <n>", "Maximum retry attempts")
  .option("--failover <enabled>", "Enable automatic failover: true / false")
  .option("--json", "Output JSON")
  .action(async (action: string, options) => {
  if (action === "start") {
    if (options.force) await app.updateProxyConfig({ enabled: true });
    if (options.daemon && !options.foreground) {
      const pid = startProxyDaemon();
      console.log(`${pc.green("OK")} proxy daemon starting pid=${pid}`);
      return;
    }
    await startProxy();
    return;
  }
  if (action === "stop") {
    const stopped = await stopProxy();
    console.log(stopped ? pc.green("OK stop signal sent") : pc.yellow("No ai-agent-switch proxy is running"));
    return;
  }
  if (action === "status") {
    const status = await proxyStatus();
    if (options.json) {
      const config = await app.loadConfig();
      console.log(JSON.stringify({ ...status, proxy: config.proxy }, null, 2));
      return;
    }
    console.log(status.running ? `${pc.green("running")} pid=${status.pid}` : pc.yellow("stopped"));
    return;
  }
  if (action === "enable") {
    const proxy = await app.updateProxyConfig({ enabled: true });
    console.log(`${pc.green("OK")} proxy enabled ${proxy.host}:${proxy.port}`);
    return;
  }
  if (action === "disable") {
    const proxy = await app.updateProxyConfig({ enabled: false });
    console.log(`${pc.green("OK")} proxy disabled ${proxy.host}:${proxy.port}`);
    return;
  }
  if (action === "set") {
    const proxy = await app.updateProxyConfig({
      host: optionalString(options.host),
      port: optionalNumber(options.port),
      upstreamProxy: optionalString(options.upstreamProxy),
      retryEnabled: optionalBoolean(options.retry),
      maxAttempts: optionalNumber(options.maxAttempts),
      failoverEnabled: optionalBoolean(options.failover),
    });
    console.log(`${pc.green("OK")} proxy ${proxy.enabled ? "enabled" : "disabled"} ${proxy.host}:${proxy.port}`);
    console.log(`${pc.dim("upstream proxy:")} ${proxy.upstreamProxy ?? "none"}`);
    console.log(`${pc.dim("retry:")} ${proxy.retry.enabled} maxAttempts=${proxy.retry.maxAttempts}`);
    console.log(`${pc.dim("failover:")} ${proxy.failover.enabled}`);
    return;
  }
  throw new Error(`Unsupported proxy action: ${action}`);
});

cli.parse(process.argv, { run: false });

try {
  await cli.runMatchedCommand();
} catch (error) {
  console.error(pc.red((error as Error).message));
  process.exitCode = 1;
}

function providerFromOptions(options: Record<string, unknown>, current?: ProviderProfile): ProviderProfile {
  const id = stringOption(options.id, "id", current?.id);
  const name = stringOption(options.name, "name", current?.name ?? id);
  const type = stringOption(options.type, "type", current?.type ?? "openai-chat-compatible") as ProviderProfile["type"];
  const models = normalizeModels(options.model).map((model) => ({ id: model }));
  const provider: ProviderProfile = {
    id,
    name,
    type,
    models: models.length > 0 ? models : current?.models ?? [],
  };
  const defaultModel = optionalString(options.defaultModel, current?.defaultModel);
  if (defaultModel) {
    if (!provider.models.some((model) => model.id === defaultModel)) {
      throw new Error(`Model not found for provider ${id}: ${defaultModel}`);
    }
    provider.defaultModel = defaultModel;
  }
  const baseUrl = optionalString(options.baseUrl, current?.baseUrl);
  if (baseUrl) provider.baseUrl = baseUrl;
  const apiKeyEnv = optionalString(options.apiKeyEnv, current?.apiKeyEnv);
  if (apiKeyEnv) provider.apiKeyEnv = apiKeyEnv;
  const apiKey = optionalString(options.apiKey, undefined);
  if (apiKey) provider.apiKey = { kind: "inline", value: apiKey };
  else if (current?.apiKey) provider.apiKey = current.apiKey;
  return provider;
}

function stringOption(value: unknown, name: string, fallback?: string): string {
  const resolved = optionalString(value, fallback);
  if (!resolved) throw new Error(`Missing --${name}`);
  return resolved;
}

function optionalString(value: unknown, fallback?: string): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function normalizeModels(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function parseProviderInitModels(value: unknown): { id: string; type: ProviderType }[] {
  const models = normalizeModels(value);
  if (models.length === 0) throw new Error("Missing --model");
  return models.map((entry) => {
    const separator = entry.lastIndexOf(":");
    if (separator === -1) {
      throw new Error(`Invalid --model: ${entry}. Expected modelId:apiMode`);
    }
    const id = entry.slice(0, separator).trim();
    if (!id) throw new Error(`Invalid --model: ${entry}`);
    const mode = parseModelApiMode(entry.slice(separator + 1).trim(), "apiMode in --model");
    return { id, type: providerTypeForModelApiMode(mode) };
  });
}

function parseClientSlots(value: unknown): ClientSlotTarget[] {
  return normalizeModels(value).map((entry) => {
    const equals = entry.indexOf("=");
    const slash = entry.indexOf("/", equals + 1);
    if (equals <= 0 || slash <= equals + 1 || slash === entry.length - 1) {
      throw new Error(`Invalid --slot: ${entry}. Expected name=provider/model`);
    }
    return {
      slot: entry.slice(0, equals).trim(),
      providerId: entry.slice(equals + 1, slash).trim(),
      modelId: entry.slice(slash + 1).trim(),
    };
  });
}

function parseProviderType(value: string, name: string): SelectableProviderType {
  if (!selectableProviderTypes.includes(value as SelectableProviderType)) {
    throw new Error(`Invalid --${name}: ${value}. Expected one of: ${selectableProviderTypes.join(", ")}`);
  }
  return value as SelectableProviderType;
}

function parseModelApiMode(value: string, name: string): ModelApiMode {
  if (!modelApiModes.includes(value as ModelApiMode)) {
    throw new Error(`Invalid ${name}: ${value}. Expected one of: ${modelApiModes.join(", ")}`);
  }
  return value as ModelApiMode;
}

function firstModelOption(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : undefined;
  if (typeof value === "string") return value;
  return undefined;
}

function formatRoute(route: { providerId: string; modelId: string }[]): string {
  return route.length > 0 ? route.map((item) => `${item.providerId}/${item.modelId}`).join(" -> ") : "empty";
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Expected integer, got ${String(value)}`);
  return parsed;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === false) return value;
  if (String(value).toLowerCase() === "true") return true;
  if (String(value).toLowerCase() === "false") return false;
  throw new Error(`Expected true or false, got ${String(value)}`);
}
