import "server-only";
import { loadConfirmedJes } from "./confirmedJes";

/**
 * Map of recon account name → net adjustment amount.
 * Sourced exclusively from user-confirmed journal entries (confirmed-jes.json).
 * Starts at zero for every account until a JE is confirmed on a section page.
 *
 * Net impact per line: debit − credit (positive = increases the account balance).
 */
export type AdjustmentMap = Map<string, number>;

export async function loadAdjustmentsByAccount(period: string): Promise<AdjustmentMap> {
  const confirmedJes = await loadConfirmedJes(period);
  const result = new Map<string, number>();

  for (const je of confirmedJes.values()) {
    for (const line of je.lines) {
      const net = line.debit - line.credit;
      if (net === 0) continue;
      result.set(line.account, (result.get(line.account) ?? 0) + net);
    }
  }

  return result;
}

/**
 * Look up the net adjustment for a recon account name.
 * Tries exact match first, then case-insensitive substring.
 */
export function adjustmentFor(map: AdjustmentMap, accountName: string): number {
  if (map.size === 0) return 0;

  const exact = map.get(accountName);
  if (exact !== undefined) return exact;

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
