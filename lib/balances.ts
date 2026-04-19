import { readFile } from "node:fs/promises";
import path from "node:path";
import "server-only";

const BALANCES_FILE = path.join(process.cwd(), ".data", "balances.json");

export type BalanceMap = Map<string, number>;

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
