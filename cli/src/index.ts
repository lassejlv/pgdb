import { loadConfig, resolveServerUrl, saveConfig } from "./config";
import { apiRequest, HttpError } from "./http";
import {
  bootstrapHetznerInfra,
  initHetznerInfra,
  printInfraBootstrap,
  printInfraInit
} from "./infra";
import { printDeploy, printDestroy, printStatus } from "./output";
import type { DeployRequest, DeployResponse, DestroyResponse, StatusResponse } from "./types";

export async function run(args: string[]): Promise<void> {
  try {
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
      printHelp();
      return;
    }

    const command = args[0];
    switch (command) {
      case "deploy":
        await handleDeploy(args.slice(1));
        return;
      case "status":
        await handleStatus(args.slice(1));
        return;
      case "destroy":
        await handleDestroy(args.slice(1));
        return;
      case "config":
        await handleConfig(args.slice(1));
        return;
      case "infra":
        await handleInfra(args.slice(1));
        return;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    const message = formatError(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

async function handleInfra(args: string[]): Promise<void> {
  if (args[0] === "init") {
    const opts = parseFlags(args.slice(1), {
      string: ["name", "location", "server-type", "image", "allow-cidr"],
      number: ["volume-size", "ssh-key-id", "pgdb-port"],
      boolean: ["json"]
    });

    const result = await initHetznerInfra({
      name: opts.strings.name,
      location: opts.strings.location,
      serverType: opts.strings["server-type"],
      image: opts.strings.image,
      volumeSize: opts.numbers["volume-size"],
      sshKeyId: opts.numbers["ssh-key-id"],
      pgdbPort: opts.numbers["pgdb-port"],
      allowCidr: opts.strings["allow-cidr"],
      json: opts.booleans.json
    });

    printInfraInit(result, opts.booleans.json === true);
    return;
  }

  if (args[0] === "bootstrap") {
    const opts = parseFlags(args.slice(1), {
      string: ["host", "user", "repo-url", "path", "public-host", "token"],
      number: ["pgdb-port"],
      boolean: ["json"]
    });

    if (!opts.strings.host) {
      throw new Error("--host is required");
    }
    if (!opts.strings["repo-url"]) {
      throw new Error("--repo-url is required");
    }

    const result = await bootstrapHetznerInfra({
      host: opts.strings.host,
      user: opts.strings.user,
      repoUrl: opts.strings["repo-url"],
      path: opts.strings.path,
      publicHost: opts.strings["public-host"],
      pgdbPort: opts.numbers["pgdb-port"],
      token: opts.strings.token
    });

    printInfraBootstrap(result, opts.booleans.json === true);
    return;
  }

  throw new Error("Usage: pgdb infra init [--name <name>] [--location <loc>] [--server-type <type>] [--image <image>] [--volume-size <gb>] [--ssh-key-id <id>] [--pgdb-port <port>] [--allow-cidr <cidr>] [--json]\n       pgdb infra bootstrap --host <ip> --repo-url <git-url> [--user <user>] [--path </opt/pgdb>] [--public-host <ip>] [--pgdb-port <port>] [--token <value>] [--json]");
}

async function handleDeploy(args: string[]): Promise<void> {
  const opts = parseFlags(args, {
    string: ["name", "server"],
    number: ["size", "version"],
    boolean: ["json"]
  });

  const token = requireToken();
  const cfg = await loadConfig();
  const { url } = resolveServerUrl(cfg, opts.strings.server);
  const body: DeployRequest = {};

  if (opts.strings.name) body.name = opts.strings.name;
  if (opts.numbers.size !== undefined) body.size_gb = opts.numbers.size;
  if (opts.numbers.version !== undefined) body.version = opts.numbers.version;

  const result = await apiRequest<DeployResponse>({
    baseUrl: url,
    token,
    method: "POST",
    path: "/v1/deploy",
    body,
    timeoutMs: 90_000
  });

  printDeploy(result, opts.booleans.json === true);
}

async function handleStatus(args: string[]): Promise<void> {
  const opts = parseFlags(args, {
    string: ["server"],
    boolean: ["json"]
  });

  const token = requireToken();
  const cfg = await loadConfig();
  const { url } = resolveServerUrl(cfg, opts.strings.server);

  const result = await apiRequest<StatusResponse>({
    baseUrl: url,
    token,
    method: "GET",
    path: "/v1/status"
  });

  printStatus(result, opts.booleans.json === true);
}

async function handleDestroy(args: string[]): Promise<void> {
  if (!args[0] || args[0].startsWith("-")) {
    throw new Error("Usage: pgdb destroy <name> [--keep-data] [--server <alias>] [--json]");
  }
  const name = args[0];
  const opts = parseFlags(args.slice(1), {
    string: ["server"],
    boolean: ["json", "keep-data"]
  });

  const token = requireToken();
  const cfg = await loadConfig();
  const { url } = resolveServerUrl(cfg, opts.strings.server);

  const result = await apiRequest<DestroyResponse>({
    baseUrl: url,
    token,
    method: "DELETE",
    path: `/v1/db/${encodeURIComponent(name)}`,
    query: {
      keep_data: opts.booleans["keep-data"] === true
    }
  });

  printDestroy(name, result, opts.booleans.json === true);
}

async function handleConfig(args: string[]): Promise<void> {
  if (args[0] !== "set" || !args[1] || !args[2]) {
    throw new Error("Usage: pgdb config set server.default <url>");
  }

  const key = args[1];
  const value = args[2];
  if (!key.startsWith("server.")) {
    throw new Error("Only server.<alias> keys are supported. Example: server.default");
  }

  validateUrl(value);

  const alias = key.slice("server.".length);
  if (!alias) {
    throw new Error("Alias cannot be empty");
  }

  const cfg = await loadConfig();
  cfg.servers[alias] = value;
  if (alias === "default") {
    cfg.defaultServer = "default";
  }

  await saveConfig(cfg);
  console.log(`Set ${key}=${value}`);
}

function parseFlags(
  args: string[],
  spec: { string?: string[]; number?: string[]; boolean?: string[] }
): {
  strings: Record<string, string | undefined>;
  numbers: Record<string, number | undefined>;
  booleans: Record<string, boolean | undefined>;
} {
  const strings: Record<string, string | undefined> = {};
  const numbers: Record<string, number | undefined> = {};
  const booleans: Record<string, boolean | undefined> = {};

  const isString = new Set(spec.string || []);
  const isNumber = new Set(spec.number || []);
  const isBoolean = new Set(spec.boolean || []);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);

    if (isBoolean.has(key)) {
      booleans[key] = true;
      continue;
    }

    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    if (isString.has(key)) {
      strings[key] = next;
      i++;
      continue;
    }

    if (isNumber.has(key)) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid number for --${key}: ${next}`);
      }
      numbers[key] = parsed;
      i++;
      continue;
    }

    throw new Error(`Unknown flag: --${key}`);
  }

  return { strings, numbers, booleans };
}

function requireToken(): string {
  const token = process.env.PGDB_TOKEN;
  if (!token) {
    throw new Error("PGDB_TOKEN is required in the environment");
  }
  return token;
}

function validateUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }

  if (!parsed.protocol.startsWith("http")) {
    throw new Error(`URL must use http or https: ${value}`);
  }
}

function formatError(error: unknown): string {
  if (error instanceof HttpError) {
    const body =
      typeof error.body === "string"
        ? error.body
        : error.body
          ? JSON.stringify(error.body)
          : "";
    return `${error.message}: ${body}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function printHelp(): void {
  console.log(`pgdb commands:
  pgdb deploy [--name <string>] [--size <gb>] [--version <major>] [--server <alias>] [--json]
  pgdb status [--server <alias>] [--json]
  pgdb destroy <name> [--keep-data] [--server <alias>] [--json]
  pgdb config set server.default <url>
  pgdb infra init [--name <name>] [--location <loc>] [--server-type <type>] [--image <image>] [--volume-size <gb>] [--ssh-key-id <id>] [--pgdb-port <port>] [--allow-cidr <cidr>] [--json]
  pgdb infra bootstrap --host <ip> --repo-url <git-url> [--user <user>] [--path </opt/pgdb>] [--public-host <ip>] [--pgdb-port <port>] [--token <value>] [--json]
`);
}
