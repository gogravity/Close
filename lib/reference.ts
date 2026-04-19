import { readFile } from "node:fs/promises";
import path from "node:path";
import "server-only";

const REFERENCE_FILE = path.join(process.cwd(), ".data", "reference-balances.json");

export type ReferenceBalance = { account: string; balance: number };

export type ReferenceData = {
  source: string;
  asOf: string;
  accounts: ReferenceBalance[];
};

export async function loadReferenceBalances(): Promise<ReferenceData | null> {
  try {
    const raw = await readFile(REFERENCE_FILE, "utf8");
    return JSON.parse(raw) as ReferenceData;
  } catch {
    return null;
  }
}
