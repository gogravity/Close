import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import "server-only";

const INPUTS_FILE = path.join(process.cwd(), ".data", "cash-recon-inputs.json");

/**
 * User-provided inputs for a single bank account rec at a single period-end.
 * Everything else (GL balance, variance, JE) is computed.
 */
export type CashReconInput = {
  accountDisplayName?: string;  // e.g. "US Bank Platinum Business Checking"
  bankAcctLast4?: string;        // e.g. "5047"
  statementBalance: number | null;
  depositsInTransit: number | null;
  outstandingChecks: number | null;
  miscAdjustmentAccount?: string; // GL account to offset any residual variance (e.g. "Miscellaneous Expense")
  notes?: string;
};

type StoredInputs = Record<string /* period */, Record<string /* bcAccountNumber */, CashReconInput>>;

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

export async function getCashReconInput(
  period: string,
  bcAccountNumber: string
): Promise<CashReconInput> {
  const data = await readRaw();
  return (
    data[period]?.[bcAccountNumber] ?? {
      statementBalance: null,
      depositsInTransit: null,
      outstandingChecks: null,
    }
  );
}

export async function setCashReconInput(
  period: string,
  bcAccountNumber: string,
  input: CashReconInput
): Promise<void> {
  const data = await readRaw();
  if (!data[period]) data[period] = {};
  data[period][bcAccountNumber] = input;
  await writeRaw(data);
}

export type CashReconComputed = {
  bcAccountNumber: string;
  bcDisplayName: string;
  unadjustedGL: number;              // from BC
  statementBalance: number | null;   // user input
  depositsInTransit: number;
  outstandingChecks: number;
  adjustedBankBalance: number | null; // statement + DIT - O/S checks
  variance: number | null;            // GL - adjustedBank (should be 0 if reconciled)
  reconciled: boolean;
  journalEntry: {
    memo: string;
    lines: { account: string; debit: number; credit: number }[];
  } | null;
};

/**
 * Compute the rec for one bank account given BC GL balance and user inputs.
 * If variance is material (> $0.01), emit a JE between the misc-adjustment
 * account and the bank GL account to force-balance.
 */
export function computeCashRecon(
  bcAccountNumber: string,
  bcDisplayName: string,
  unadjustedGL: number,
  input: CashReconInput
): CashReconComputed {
  const dit = input.depositsInTransit ?? 0;
  const oc = input.outstandingChecks ?? 0;
  const statementBalance = input.statementBalance;
  const adjustedBankBalance =
    statementBalance === null ? null : statementBalance + dit - oc;
  const variance =
    adjustedBankBalance === null ? null : unadjustedGL - adjustedBankBalance;

  const materialVariance = variance !== null && Math.abs(variance) >= 0.01;
  const miscAcct = input.miscAdjustmentAccount || "Miscellaneous Expense";

  let journalEntry: CashReconComputed["journalEntry"] = null;
  if (materialVariance && variance !== null) {
    const abs = Math.abs(variance);
    if (variance > 0) {
      // GL > Bank → GL overstated → credit cash, debit misc expense
      journalEntry = {
        memo: `True up ${bcDisplayName} — write off variance ${abs.toFixed(2)}`,
        lines: [
          { account: miscAcct, debit: abs, credit: 0 },
          { account: bcDisplayName, debit: 0, credit: abs },
        ],
      };
    } else {
      // GL < Bank → GL understated → debit cash, credit misc income
      journalEntry = {
        memo: `True up ${bcDisplayName} — write up variance ${abs.toFixed(2)}`,
        lines: [
          { account: bcDisplayName, debit: abs, credit: 0 },
          { account: miscAcct, debit: 0, credit: abs },
        ],
      };
    }
  }

  return {
    bcAccountNumber,
    bcDisplayName,
    unadjustedGL,
    statementBalance,
    depositsInTransit: dit,
    outstandingChecks: oc,
    adjustedBankBalance,
    variance,
    reconciled: !materialVariance && statementBalance !== null,
    journalEntry,
  };
}
