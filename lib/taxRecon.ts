import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import "server-only";

const FILE = path.join(process.cwd(), ".data", "tax-recon.json");

export type TaxReconInput = {
  filedLiability: number | null;  // Total Sales Tax Payable per compliance report
  adjustment: number | null;      // Known reconciling adjustment
  notes?: string;
};

type Stored = Record<string /* period */, Record<string /* bcAccountNumber */, TaxReconInput>>;

async function readRaw(): Promise<Stored> {
  try {
    const raw = await readFile(FILE, "utf8");
    return JSON.parse(raw) as Stored;
  } catch {
    return {};
  }
}

async function writeRaw(data: Stored): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export async function getInputsForPeriod(
  period: string
): Promise<Record<string, TaxReconInput>> {
  const data = await readRaw();
  return data[period] ?? {};
}

export async function setInput(
  period: string,
  bcAccountNumber: string,
  input: TaxReconInput
): Promise<void> {
  const data = await readRaw();
  if (!data[period]) data[period] = {};
  if (
    input.filedLiability === null &&
    input.adjustment === null &&
    !input.notes
  ) {
    delete data[period][bcAccountNumber];
  } else {
    data[period][bcAccountNumber] = input;
  }
  await writeRaw(data);
}
