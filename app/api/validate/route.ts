import { NextResponse } from "next/server";
import { listAccounts, getAccountBalances, BusinessCentralError } from "@/lib/businessCentral";
import { loadReferenceBalances } from "@/lib/reference";

export const dynamic = "force-dynamic";

type CategoryTotals = { Assets: number; Liabilities: number; Equity: number };

export async function GET() {
  const reference = await loadReferenceBalances();
  if (!reference) {
    return NextResponse.json(
      { ok: false, error: "No reference file (.data/reference-balances.json) present." },
      { status: 200 }
    );
  }
  try {
    const [accounts, balances] = await Promise.all([
      listAccounts(),
      getAccountBalances(reference.asOf),
    ]);
    const bcTotals: CategoryTotals = { Assets: 0, Liabilities: 0, Equity: 0 };
    const bcAccounts = accounts.map((a) => {
      const bal = balances.get(a.number) ?? 0;
      const cat = a.category;
      if (cat === "Assets") bcTotals.Assets += bal;
      else if (cat === "Liabilities") bcTotals.Liabilities += bal;
      else if (cat === "Equity") bcTotals.Equity += bal;
      return {
        number: a.number,
        displayName: a.displayName,
        category: cat,
        subCategory: a.subCategory,
        balance: bal,
      };
    });
    const refTotals: CategoryTotals = { Assets: 0, Liabilities: 0, Equity: 0 };
    for (const r of reference.accounts) {
      const c = r.classification;
      if (c === "Assets" || c === "Liabilities" || c === "Equity") refTotals[c] += r.balance;
    }
    const bcCheck = bcTotals.Assets + bcTotals.Liabilities + bcTotals.Equity;
    const refCheck = refTotals.Assets + refTotals.Liabilities + refTotals.Equity;
    return NextResponse.json({
      ok: true,
      asOf: reference.asOf,
      reference: {
        source: reference.source,
        totals: refTotals,
        check: refCheck,
        accountCount: reference.accounts.length,
      },
      bc: {
        totals: bcTotals,
        check: bcCheck,
        accountCount: bcAccounts.length,
        accountsWithBalance: bcAccounts.filter((a) => a.balance !== 0).length,
      },
      variance: {
        Assets: bcTotals.Assets - refTotals.Assets,
        Liabilities: bcTotals.Liabilities - refTotals.Liabilities,
        Equity: bcTotals.Equity - refTotals.Equity,
        check: bcCheck - refCheck,
      },
      accounts: bcAccounts.filter((a) => a.balance !== 0),
    });
  } catch (err) {
    if (err instanceof BusinessCentralError) {
      return NextResponse.json(
        { ok: false, error: err.message, status: err.status, body: err.body },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 200 });
  }
}
