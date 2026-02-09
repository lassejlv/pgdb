import { mkdir } from "node:fs/promises";
import type { PgdbConfig } from "./types";

const CONFIG_DIR = `${process.env.HOME || ""}/.config/pgdb`;
const CONFIG_PATH = `${CONFIG_DIR}/config.json`;

const DEFAULT_CONFIG: PgdbConfig = {
  defaultServer: "default",
  servers: {}
};

export async function loadConfig(): Promise<PgdbConfig> {
  const file = Bun.file(CONFIG_PATH);
  if (!(await file.exists())) {
    return structuredClone(DEFAULT_CONFIG);
  }

  const text = await file.text();
  if (!text.trim()) {
    return structuredClone(DEFAULT_CONFIG);
  }

  const parsed = JSON.parse(text) as Partial<PgdbConfig>;
  return {
    defaultServer: parsed.defaultServer || "default",
    servers: parsed.servers || {}
  };
}

export async function saveConfig(cfg: PgdbConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await Bun.write(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`);
}

export function resolveServerUrl(
  cfg: PgdbConfig,
  alias?: string
): { alias: string; url: string } {
  const selected = alias || cfg.defaultServer;
  const url = cfg.servers[selected];
  if (!url) {
    throw new Error(
      `Server alias '${selected}' is not configured. Run: pgdb config set server.default <url>`
    );
  }
  return { alias: selected, url };
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
