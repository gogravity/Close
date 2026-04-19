import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import "server-only";

const FILE = path.join(process.cwd(), ".data", "prepaid-decisions.json");

export type PrepaidRecognition = {
  months: number;       // amortization duration (e.g. 1, 6, 12)
  beginDate: string;    // yyyy-mm-dd — when the service/trip begins
  endDate: string;      // yyyy-mm-dd — when the service/trip ends
};

export type PrepaidDecision = {
  confirmed: boolean;
  recognition?: PrepaidRecognition;
  notes?: string;
};

type Stored = Record<
  string /* period yyyy-mm-dd */,
  Record<string /* BC entry number as string */, PrepaidDecision>
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

export async function getDecisionsForPeriod(
  period: string
): Promise<Record<string, PrepaidDecision>> {
  const data = await readRaw();
  return data[period] ?? {};
}

export async function setDecision(
  period: string,
  entryNumber: number,
  decision: PrepaidDecision
): Promise<void> {
  const data = await readRaw();
  if (!data[period]) data[period] = {};
  if (!decision.confirmed && !decision.notes) {
    delete data[period][String(entryNumber)];
  } else {
    data[period][String(entryNumber)] = decision;
  }
  await writeRaw(data);
}
