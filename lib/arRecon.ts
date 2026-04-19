import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import "server-only";

const INPUTS_FILE = path.join(process.cwd(), ".data", "ar-recon-inputs.json");

/**
 * Allowance rates for each aging bucket, per reconciliation period.
 * Defaults mirror Gravity's historical allowance matrix on the Excel AR tab.
 */
export type ArReconInput = {
  /**
   * Allowance rates are corporate policy set by Lyra and are not user-editable.
   * They are stored per period for audit trail only.
   */
  allowanceRates: {
    current: number;
    period1: number; // 31-60 days
    period2: number; // 61-90 days
    period3: number; // 91+ days
  };
  badDebtExpenseAccountNumber?: string;
  notes?: string;
};

export const DEFAULT_RATES: ArReconInput["allowanceRates"] = {
  current: 0,
  period1: 0.05,
  period2: 0.10,
  period3: 0.50,
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
  return (
    data[period] ?? {
      allowanceRates: { ...DEFAULT_RATES },
    }
  );
}

export async function setArReconInput(period: string, input: ArReconInput): Promise<void> {
  const data = await readRaw();
  data[period] = input;
  await writeRaw(data);
}
