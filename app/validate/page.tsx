import { redirect } from "next/navigation";
import { getEntityConfig } from "@/lib/settings";
import { listAccounts, getAccountBalances, BusinessCentralError } from "@/lib/businessCentral";
import { loadReferenceBalances } from "@/lib/reference";
import { fmt } from "@/lib/recon";

export const dynamic = "force-dynamic";

export default async function ValidatePage() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");

  const reference = await loadReferenceBalances();
  if (!reference) {
    return (
      <div className="px-8 py-10 max-w-3xl">
        <h1 className="text-xl font-semibold text-slate-900">Validation</h1>
        <p className="mt-2 text-sm text-slate-600">
          No reference file present. Drop a <code>reference-balances.json</code> into{" "}
          <code>.data/</code> with known-good totals to enable side-by-side comparison.
        </p>
      </div>
    );
  }

  try {
    const [accounts, balances] = await Promise.all([
      listAccounts(),
      getAccountBalances(reference.asOf),
    ]);
    const bcTotals = { Assets: 0, Liabilities: 0, Equity: 0 };
    let bcAccountsWithBalance = 0;
    for (const a of accounts) {
      const b = balances.get(a.number) ?? 0;
      if (b !== 0) bcAccountsWithBalance++;
      if (a.category === "Assets") bcTotals.Assets += b;
      else if (a.category === "Liabilities") bcTotals.Liabilities += b;
      else if (a.category === "Equity") bcTotals.Equity += b;
    }
    const refTotals = { Assets: 0, Liabilities: 0, Equity: 0 };
    for (const r of reference.accounts) {
      const c = r.classification as keyof typeof refTotals | undefined;
      if (c && c in refTotals) refTotals[c] += r.balance;
    }
    const bcCheck = bcTotals.Assets + bcTotals.Liabilities + bcTotals.Equity;
    const refCheck = refTotals.Assets + refTotals.Liabilities + refTotals.Equity;
    const variance = {
      Assets: bcTotals.Assets - refTotals.Assets,
      Liabilities: bcTotals.Liabilities - refTotals.Liabilities,
      Equity: bcTotals.Equity - refTotals.Equity,
      check: bcCheck - refCheck,
    };

    return (
      <div className="px-8 py-8 max-w-5xl">
        <header className="mb-6">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Diagnostic · as of {reference.asOf}
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">
            Balance Sheet Validation
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Side-by-side comparison of reference (
            <span className="text-slate-700">{reference.source}</span>) against Business
            Central, fetched live at page load.
          </p>
        </header>

        <div className="overflow-hidden rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Category</th>
                <th className="px-4 py-2 text-right font-medium">
                  Reference<br />
                  <span className="text-[10px] font-normal text-slate-500">
                    ({reference.accounts.length} accounts)
                  </span>
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  Business Central<br />
                  <span className="text-[10px] font-normal text-slate-500">
                    ({bcAccountsWithBalance} accounts with balance)
                  </span>
                </th>
                <th className="px-4 py-2 text-right font-medium">Variance</th>
                <th className="px-4 py-2 text-right font-medium">% of Reference</th>
              </tr>
            </thead>
            <tbody>
              {(["Assets", "Liabilities", "Equity"] as const).map((k) => {
                const v = variance[k];
                const pct =
                  refTotals[k] !== 0 ? (v / Math.abs(refTotals[k])) * 100 : 0;
                return (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="px-4 py-1.5 font-medium">{k}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{fmt(refTotals[k])}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{fmt(bcTotals[k])}</td>
                    <td
                      className={`px-4 py-1.5 text-right tabular-nums ${
                        Math.abs(v) < 1 ? "text-slate-500" : "text-amber-700"
                      }`}
                    >
                      {fmt(v)}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">
                      {refTotals[k] !== 0 ? `${pct.toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                <td className="px-4 py-1.5">
                  Check <span className="text-xs font-normal text-slate-500">(A+L+E)</span>
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">{fmt(refCheck)}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{fmt(bcCheck)}</td>
                <td
                  className={`px-4 py-1.5 text-right tabular-nums ${
                    Math.abs(variance.check) < 1 ? "text-emerald-700" : "text-amber-700"
                  }`}
                >
                  {fmt(variance.check)}
                </td>
                <td className="px-4 py-1.5 text-right">—</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-6 rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <div className="font-medium text-slate-900">Interpretation</div>
          <p className="mt-1">
            A non-zero variance typically reflects GL activity posted to Business Central
            <em> after</em> the reference snapshot was created. The reference here is the
            &ldquo;unadjusted&rdquo; column from a close workbook, so additional postings between
            the workbook date and now produce the difference. The fact that the BC check is
            closer to zero (
            <span className="font-mono">{fmt(bcCheck)}</span>) than the reference check (
            <span className="font-mono">{fmt(refCheck)}</span>) suggests adjusting entries have
            since been posted to BC — exactly what we&apos;d expect.
          </p>
        </div>
      </div>
    );
  } catch (err) {
    if (err instanceof BusinessCentralError) {
      return (
        <div className="px-8 py-8 max-w-3xl">
          <h1 className="text-xl font-semibold text-red-700">BC fetch failed</h1>
          <pre className="mt-3 rounded bg-slate-100 p-3 text-xs">
            {err.message}
            {err.body ? `\n\n${JSON.stringify(err.body, null, 2)}` : ""}
          </pre>
        </div>
      );
    }
    throw err;
  }
}
