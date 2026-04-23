import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import "server-only";

const INPUTS_FILE = path.join(process.cwd(), ".data", "ar-recon-inputs.json");

export type AllowanceRates = {
  current: number;
  d1to60: number;
  d61to90: number;
  d91to180: number;
  d181to360: number;
  over360: number;
};

export type ArReconInput = {
  /**
   * Allowance rates are corporate policy set by Lyra and are not user-editable.
   * They are stored per period for audit trail only.
   */
  allowanceRates: AllowanceRates;
  badDebtExpenseAccountNumber?: string;
  notes?: string;
};

export const DEFAULT_RATES: AllowanceRates = {
  current: 0,
  d1to60: 0.05,
  d61to90: 0.10,
  d91to180: 0.20,
  d181to360: 0.50,
  over360: 1.00,
};

type StoredInputs = Record<string /* period */, ArReconInput>;

async function readRaw(): Promise<StoredInputs> {
  try {
    const raw = await readFile(INPUTS_FILE, "utf8");
    return JSON.parse(raw) as StoredInputs;
  } catch {
    return {};
  }
}

async function writeRaw(data: StoredInputs): Promise<void> {
  await mkdir(path.dirname(INPUTS_FILE), { recursive: true });
  await writeFile(INPUTS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export async function getArReconInput(period: string): Promise<ArReconInput> {
  const data = await readRaw();
  const stored = data[period];
  if (!stored) {
    return { allowanceRates: { ...DEFAULT_RATES } };
  }
  // Always use current corporate policy rates regardless of what was stored
  // under the old 4-bucket schema.
  return { ...stored, allowanceRates: { ...DEFAULT_RATES } };
}

export async function setArReconInput(period: string, input: ArReconInput): Promise<void> {
  const data = await readRaw();
  data[period] = input;
  await writeRaw(data);
}
