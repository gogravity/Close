import { NextResponse } from "next/server";
import {
  BusinessCentralError,
  listGlBudgets,
  listGlBudgetEntries,
  listGlEntriesRange,
  listAccounts,
  type BcGlBudget,
} from "@/lib/businessCentral";

export const dynamic = "force-dynamic";

type PlCategory = "Income" | "CostOfGoodsSold" | "Expense";

function isPlCategory(cat: string | undefined): cat is PlCategory {
  return cat === "Income" || cat === "CostOfGoodsSold" || cat === "Expense";
}

// P&L accounts: Income shown as credit − debit (positive = revenue);
// COGS/Expense shown as debit − credit (positive = expense).
function plSigned(cat: PlCategory, debit: number, credit: number): number {
  if (cat === "Income") return (credit ?? 0) - (debit ?? 0);
  return (debit ?? 0) - (credit ?? 0);
}

// Budget amounts in BC: credit-side for revenue, debit-side for expense —
// the `amount` field carries sign per BC convention. Normalize so positive
// = expected magnitude for each category (matches the actuals sign above).
function budgetSigned(cat: PlCategory, amount: number): number {
  if (cat === "Income") return -amount;
  return amount;
}

function validMonth(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const m = /^(\d{4})-(\d{2})$/.exec(val.trim());
  if (!m) return null;
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return `${m[1]}-${m[2]}`;
}

function monthRangeToDates(startMonth: string, endMonth: string): { start: string; end: string } {
  const [sy, sm] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  const start = `${sy}-${String(sm).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(ey, em, 0)).getUTCDate();
  const end = `${ey}-${String(em).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export async function GET() {
  try {
    const budgets = await listGlBudgets();
    return NextResponse.json({ ok: true, budgets });
  } catch (err) {
    if (err instanceof BusinessCentralError) {
      return NextResponse.json(
        {
          ok: false,
          error: err.message,
          status: err.status,
          body: err.body,
        },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const budgetName = typeof b?.budgetName === "string" ? b.budgetName.trim() : "";
  const startMonth = validMonth(b?.startMonth);
  const endMonth = validMonth(b?.endMonth);
  if (!budgetName) {
    return NextResponse.json({ ok: false, error: "budgetName required" }, { status: 400 });
  }
  if (!startMonth || !endMonth) {
    return NextResponse.json(
      { ok: false, error: "startMonth and endMonth required as YYYY-MM" },
      { status: 400 }
    );
  }
  if (startMonth > endMonth) {
    return NextResponse.json(
      { ok: false, error: "startMonth must be ≤ endMonth" },
      { status: 400 }
    );
  }

  const { start, end } = monthRangeToDates(startMonth, endMonth);

  try {
    const [budgets, budgetEntries, glEntries, accounts] = await Promise.all([
      listGlBudgets(),
      listGlBudgetEntries(budgetName, start, end),
      listGlEntriesRange(start, end),
      listAccounts(),
    ]);

    const accountByNumber = new Map(accounts.map((a) => [a.number, a]));
    const plAccounts = accounts.filter((a) => isPlCategory(a.category));
    const plAcctSet = new Set(plAccounts.map((a) => a.number));

    type Row = {
      accountNumber: string;
      accountName: string;
      category: PlCategory;
      actual: number;
      budget: number;
    };

    const rowByAcct = new Map<string, Row>();
    const ensure = (accountNumber: string): Row => {
      const existing = rowByAcct.get(accountNumber);
      if (existing) return existing;
      const meta = accountByNumber.get(accountNumber);
      const cat: PlCategory = isPlCategory(meta?.category) ? (meta!.category as PlCategory) : "Expense";
      const row: Row = {
        accountNumber,
        accountName: meta?.displayName ?? accountNumber,
        category: cat,
        actual: 0,
        budget: 0,
      };
      rowByAcct.set(accountNumber, row);
      return row;
    };

    // Accumulate actuals for P&L accounts only
    for (const e of glEntries) {
      if (!e.accountNumber || !plAcctSet.has(e.accountNumber)) continue;
      const row = ensure(e.accountNumber);
      row.actual += plSigned(row.category, e.debitAmount ?? 0, e.creditAmount ?? 0);
    }

    // Accumulate budget amounts for P&L accounts only
    for (const be of budgetEntries) {
      if (!be.accountNumber || !plAcctSet.has(be.accountNumber)) continue;
      const row = ensure(be.accountNumber);
      row.budget += budgetSigned(row.category, be.amount ?? 0);
    }

    const rows = Array.from(rowByAcct.values())
      .filter((r) => Math.abs(r.actual) > 0.001 || Math.abs(r.budget) > 0.001)
      .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));

    const totalsByCategory = { Income: { actual: 0, budget: 0 }, CostOfGoodsSold: { actual: 0, budget: 0 }, Expense: { actual: 0, budget: 0 } };
    for (const r of rows) {
      totalsByCategory[r.category].actual += r.actual;
      totalsByCategory[r.category].budget += r.budget;
    }

    return NextResponse.json({
      ok: true,
      budgetName,
      startMonth,
      endMonth,
      budgets: budgets.map((x: BcGlBudget) => ({ name: x.name, description: x.description ?? "" })),
      rows,
      totalsByCategory,
    });
  } catch (err) {
    if (err instanceof BusinessCentralError) {
      return NextResponse.json(
        { ok: false, error: err.message, status: err.status, body: err.body },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
