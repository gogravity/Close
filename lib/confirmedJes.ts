import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import "server-only";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "confirmed-jes.json");

export type ConfirmedJeLine = {
  account: string;
  debit: number;
  credit: number;
};

export type ConfirmedJe = {
  memo: string;
  lines: ConfirmedJeLine[];
  confirmedAt: string; // ISO timestamp
};

/** period (YYYY-MM) → sectionSlug → ConfirmedJe */
type Store = Record<string, Record<string, ConfirmedJe>>;

async function load(): Promise<Store> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Store;
  } catch {
    return {};
  }
}

async function save(store: Store): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(store, null, 2));
}

/** Returns all confirmed JEs for a given period, keyed by section slug. */
export async function loadConfirmedJes(period: string): Promise<Map<string, ConfirmedJe>> {
  const store = await load();
  const bySection = store[period] ?? {};
  return new Map(Object.entries(bySection));
}

/** Persist a confirmed JE for a section+period. Overwrites any prior entry. */
export async function confirmJe(
  period: string,
  sectionSlug: string,
  je: Omit<ConfirmedJe, "confirmedAt">
): Promise<void> {
  const store = await load();
  store[period] ??= {};
  store[period][sectionSlug] = { ...je, confirmedAt: new Date().toISOString() };
  await save(store);
}

/** Remove a confirmed JE for a section+period. */
export async function unconfirmJe(period: string, sectionSlug: string): Promise<void> {
  const store = await load();
  if (store[period]) {
    delete store[period][sectionSlug];
    if (Object.keys(store[period]).length === 0) delete store[period];
  }
  await save(store);
}
