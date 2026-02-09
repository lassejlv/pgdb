import type { DeployResponse, DestroyResponse, StatusResponse } from "./types";

export function printDeploy(result: DeployResponse, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(toDeployCliShape(result), null, 2));
    return;
  }

  const out = toDeployCliShape(result);
  console.log(`name: ${out.name}`);
  console.log(`host: ${out.host}`);
  console.log(`port: ${out.port}`);
  console.log(`db: ${out.db}`);
  console.log(`user: ${out.user}`);
  console.log(`password: ${out.password}`);
  console.log(`DATABASE_URL: ${out.DATABASE_URL}`);
}

export function printStatus(result: StatusResponse, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.items.length === 0) {
    console.log("No databases found.");
    return;
  }

  for (const item of result.items) {
    console.log(`${item.name} (${item.postgres_version})`);
    console.log(`  host: ${item.host}`);
    console.log(`  port: ${item.host_port}`);
    console.log(`  db: ${item.db}`);
    console.log(`  user: ${item.user}`);
    console.log(`  created_at: ${item.created_at}`);
    console.log(`  DATABASE_URL: ${item.database_url}`);
  }
}

export function printDestroy(
  name: string,
  result: DestroyResponse,
  asJson: boolean
): void {
  if (asJson) {
    console.log(JSON.stringify({ name, ...result }, null, 2));
    return;
  }

  if (result.ok) {
    console.log(`Destroyed ${name}`);
  }
}

function toDeployCliShape(result: DeployResponse): {
  name: string;
  host: string;
  port: number;
  db: string;
  user: string;
  password: string;
  DATABASE_URL: string;
} {
  return {
    name: result.name,
    host: result.host,
    port: result.port,
    db: result.db,
    user: result.user,
    password: result.password,
    DATABASE_URL: result.database_url
  };
}
