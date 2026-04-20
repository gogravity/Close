import { redirect } from "next/navigation";
import { getEntityConfig } from "@/lib/settings";
import { buildClosePackage } from "@/lib/export";
import { fmt } from "@/lib/recon";

export const dynamic = "force-dynamic";

export default async function ExportPage() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");

  let summary;
  try {
    summary = (await buildClosePackage()).summary;
  } catch (err) {
    return (
      <div className="px-8 py-10 max-w-3xl">
        <h1 className="text-xl font-semibold text-red-700">Export failed</h1>
        <pre className="mt-3 rounded bg-slate-100 p-3 text-xs">{(err as Error).message}</pre>
      </div>
    );
  }

  const unmatched = summary.rows.filter((r) => !r.matchedNumber);

  return (
    <div className="px-8 py-8 max-w-5xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          Close Package · as of {summary.asOf}
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Export</h1>
        <p className="mt-1 text-sm text-slate-600">
          Downloads a single <code>.xlsx</code> with two sheets: a row-for-row clone of the{" "}
          <em>Nov&apos;25 Close</em> tab populated with BC balances for the matched rows, and a
          full <em>BC Trial Balance</em> sheet for drill-down. Open alongside your master
          workbook and paste each range over.
        </p>
      </header>

      <div className="mb-6 flex items-center gap-4 rounded border border-slate-200 bg-white px-5 py-4">
        <div className="flex-1">
          <div className="text-sm font-medium text-slate-900">
            Close workbook — {summary.asOf}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {summary.matched} of {summary.matched + summary.unmatched} BS Summary rows
            auto-matched to BC accounts.
          </div>
        </div>
        <a
          href={`/api/export?format=xlsx`}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Download .xlsx
        </a>
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Matched rows ({summary.matched})
        </h2>
        <div className="overflow-hidden rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Live report row</th>
                <th className="px-3 py-2 text-left font-medium">Matched BC account</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows
                .filter((r) => r.matchedNumber)
                .map((r) => (
                  <tr key={r.rowIndex} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">{r.label}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-600">
                      {r.matchedNumber} — {r.matchedName}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.balance != null ? fmt(r.balance) : "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Unmatched rows ({unmatched.length}) — will be blank in the export
        </h2>
        <div className="overflow-hidden rounded border border-amber-200 bg-amber-50/50">
          <ul className="divide-y divide-amber-100 text-sm">
            {unmatched.map((r) => (
              <li key={r.rowIndex} className="px-3 py-1.5 text-slate-700">
                {r.label}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          These rows didn&apos;t match a Business Central account by name with enough confidence
          (e.g. manual adjustment lines, closed credit cards, accounts in your live report
          that don&apos;t exist in BC, or accounts where BC&apos;s naming differs significantly). We&apos;ll add a manual override UI next.
        </p>
      </section>
    </div>
  );
}
