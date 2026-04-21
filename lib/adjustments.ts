import { readFile } from "node:fs/promises";
import path from "node:path";
import "server-only";

const TEMPLATE_FILE = path.join(process.cwd(), ".data", "adjustments-template.json");

type AdjustmentColumn = {
  columnLetter: string;
  description: string;
  reverseFlag: string | null;
  entries: Record<string, number>;
  entryCount: number;
};

type AdjustmentsTemplate = {
  source: string;
  sourcePeriod: string;
  asOf: string;
  adjustments: AdjustmentColumn[];
};

/**
 * Map of account display name → net adjustment amount across all JE columns.
 * Keys use the exact casing from the template file.
 */
export type AdjustmentMap = Map<string, number>;

export async function loadAdjustmentsByAccount(): Promise<AdjustmentMap> {
  try {
    const raw = await readFile(TEMPLATE_FILE, "utf8");
    const template = JSON.parse(raw) as AdjustmentsTemplate;
    const result = new Map<string, number>();
    for (const col of template.adjustments) {
      for (const [acct, amount] of Object.entries(col.entries)) {
        if (amount === 0) continue;
        result.set(acct, (result.get(acct) ?? 0) + amount);
      }
    }
    return result;
  } catch {
    return new Map();
  }
}

/**
 * Look up the net adjustment amount for a given recon account name.
 * Tries exact match first, then falls back to a case-insensitive substring
 * match (BC displayNames in the template sometimes include extra context).
 */
export function adjustmentFor(map: AdjustmentMap, accountName: string): number {
  if (map.size === 0) return 0;

  // 1. Exact match
  const exact = map.get(accountName);
  if (exact !== undefined) return exact;

  // 2. Case-insensitive substring match
  const nameLower = accountName.toLowerCase();
  let total = 0;
  for (const [key, val] of map) {
    const keyLower = key.toLowerCase();
    if (keyLower.includes(nameLower) || nameLower.includes(keyLower)) {
      total += val;
    }
  }
  return total;
}
