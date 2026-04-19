import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import "server-only";
import type { BcAccount } from "./businessCentral";

const CONFIG_FILE = path.join(process.cwd(), ".data", "prepaid-scan-config.json");

export type PrepaidScanConfig = {
  /** Explicit allow-list of BC account numbers to scan. Empty = use default heuristic. */
  includedAccountNumbers: string[];
};

/**
 * Default heuristic — derived from the categories the user has historically
 * reclassed to prepaid (travel, insurance, software/cloud, managed services,
 * intercompany G&A, office 365, other marketing, recurring cloud resale).
 */
const DEFAULT_KEYWORDS = [
  /travel/i,
  /airline|airfare/i,
  /hotel|lodging/i,
  /insurance/i,
  /software/i,
  /cloud/i,
  /office\s*365/i,
  /managed\s*services/i,
  /intercompany/i,
  /marketing/i,
  /subscription/i,
];

export function defaultSelectedAccounts(accounts: BcAccount[]): string[] {
  const expenseLike = accounts.filter(
    (a) => a.category === "Expense" || a.category === "CostOfGoodsSold"
  );
  return expenseLike
    .filter((a) => DEFAULT_KEYWORDS.some((re) => re.test(a.displayName)))
    .map((a) => a.number);
}

export async function getPrepaidScanConfig(): Promise<PrepaidScanConfig> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw) as PrepaidScanConfig;
  } catch {
    return { includedAccountNumbers: [] };
  }
}

export async function setPrepaidScanConfig(
  config: PrepaidScanConfig
): Promise<void> {
  await mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export async function resolveSelectedAccounts(
  allAccounts: BcAccount[]
): Promise<Set<string>> {
  const config = await getPrepaidScanConfig();
  const nums =
    config.includedAccountNumbers.length > 0
      ? config.includedAccountNumbers
      : defaultSelectedAccounts(allAccounts);
  return new Set(nums);
}
