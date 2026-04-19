import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import "server-only";

const FILE = path.join(process.cwd(), ".data", "payroll-liab-recon.json");

export type PayrollLiabInput = {
  expectedBalance: number | null;
  notes?: string;
};

type Stored = Record<
  string /* period yyyy-mm-dd */,
  Record<string /* BC account number */, PayrollLiabInput>
>;

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
): Promise<Record<string, PayrollLiabInput>> {
  const data = await readRaw();
  return data[period] ?? {};
}

export async function setInput(
  period: string,
  bcAccountNumber: string,
  input: PayrollLiabInput
): Promise<void> {
  const data = await readRaw();
  if (!data[period]) data[period] = {};
  if (input.expectedBalance === null && !input.notes) {
    delete data[period][bcAccountNumber];
  } else {
    data[period][bcAccountNumber] = input;
  }
  await writeRaw(data);
}
