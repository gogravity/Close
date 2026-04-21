import { readFile } from "node:fs/promises";
import path from "node:path";
import "server-only";

const BALANCES_FILE = path.join(process.cwd(), ".data", "balances.json");
const META_FILE = path.join(process.cwd(), ".data", "sync-meta.json");

export type BalanceMap = Map<string, number>;

export type SyncMeta = {
  syncedAt: string; // ISO timestamp
  asOf: string;     // YYYY-MM-DD period end
};

export async function loadBalances(): Promise<BalanceMap> {
  try {
    const raw = await readFile(BALANCES_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, number>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export function balanceOf(map: BalanceMap, accountName: string): number {
  return map.get(accountName) ?? 0;
}

export async function loadSyncMeta(): Promise<SyncMeta | null> {
  try {
    const raw = await readFile(META_FILE, "utf8");
    return JSON.parse(raw) as SyncMeta;
  } catch {
    return null;
  }
}
