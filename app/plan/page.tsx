import { redirect } from "next/navigation";
import { getEntityConfig } from "@/lib/settings";
import { loadCatalog, planFor, type AutomationStrategy } from "@/lib/reconPlan";
import { fmt } from "@/lib/recon";
import { getAccountBalances } from "@/lib/businessCentral";

export const dynamic = "force-dynamic";

const STRATEGY_META: Record<
  AutomationStrategy,
  { label: string; className: string }
> = {
  "bc-live": { label: "BC Live", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  "bc-schedule": { label: "BC Schedule", className: "bg-blue-100 text-blue-800 border-blue-200" },
  "cw-api": { label: "ConnectWise", className: "bg-violet-100 text-violet-800 border-violet-200" },
  "ramp-api": { label: "Ramp", className: "bg-orange-100 text-orange-800 border-orange-200" },
  "gusto-api": { label: "Gusto", className: "bg-pink-100 text-pink-800 border-pink-200" },
  "plaid-bank": { label: "Bank feed", className: "bg-teal-100 text-teal-800 border-teal-200" },
  "alt-payments-api": { label: "Alt Payments", className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  "roll-forward": { label: "Roll-forward", className: "bg-amber-100 text-amber-800 border-amber-200" },
  manual: { label: "Manual", className: "bg-slate-100 text-slate-700 border-slate-200" },
  closed: { label: "Closed", className: "bg-slate-100 text-slate-500 border-slate-200" },
  none: { label: "—", className: "bg-slate-50 text-slate-400 border-slate-200" },
};

const STATUS_META: Record<string, { label: string; dot: string }> = {
  automatable: { label: "Automatable", dot: "bg-emerald-500" },
  partial: { label: "Partial", dot: "bg-amber-500" },
  "manual-only": { label: "Manual", dot: "bg-slate-400" },
  dormant: { label: "Dormant", dot: "bg-slate-300" },
};

export default async function PlanPage() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");

  const catalog = await loadCatalog();
  if (!catalog) {
    return (
      <div className="px-8 py-10 max-w-3xl">
        <h1 className="text-xl font-semibold text-slate-900">Recon Plan</h1>
        <p className="mt-2 text-sm text-slate-600">
          No BS row catalog present. Extract from the master workbook into{" "}
          <code>.data/bs-row-catalog.json</code>.
        </p>
      </div>
    );
  }

  // Pull live BC balances so we can show current unadjusted vs catalog unadjusted
  let liveBalances = new Map<string, number>();
  let liveError: string | null = null;
  try {
    const balances = await getAccountBalances(catalog.asOf);
    liveBalances = balances;
  } catch (err) {
    liveError = (err as Error).message;
  }

  // Group rows by source tab
  const withTab = catalog.rows.filter((r) => r.sourceTab);

  const byTab = new Map<string, typeof catalog.rows>();
  for (const r of withTab) {
    const list = byTab.get(r.sourceTab!) ?? [];
    list.push(r);
    byTab.set(r.sourceTab!, list);
  }

  // Automation status summary
  const statusCounts = { automatable: 0, partial: 0, "manual-only": 0, dormant: 0, unknown: 0 };
  for (const [tab] of byTab) {
    const p = planFor(tab);
    if (!p) statusCounts.unknown++;
    else statusCounts[p.status]++;
  }

  return (
    <div className="px-8 py-8 max-w-7xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          Workbook analysis · as of {catalog.asOf}
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Recon Plan</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every balance sheet row in the live report, its source reconciliation tab, and how
          we intend to automate the adjustment. Compiled from the hyperlinks + comments on the
          master workbook&apos;s <em>Gravity BS 2025</em> sheet.
        </p>
      </header>

      <div className="mb-6 grid grid-cols-4 gap-3">
        <StatPill label="Automatable tabs" value={statusCounts.automatable} tone="emerald" />
        <StatPill label="Partial / deps pending" value={statusCounts.partial} tone="amber" />
        <StatPill label="Manual-only" value={statusCounts["manual-only"]} tone="slate" />
        <StatPill label="Dormant / closed" value={statusCounts.dormant} tone="slate" />
      </div>

      <div className="overflow-hidden rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-[70px]">BC #</th>
              <th className="px-3 py-2 text-left font-medium">BS row</th>
              <th className="px-3 py-2 text-right font-medium w-[110px]">Unadj (Excel)</th>
              <th className="px-3 py-2 text-right font-medium w-[110px]">Unadj (BC live)</th>
              <th className="px-3 py-2 text-left font-medium">Source tab</th>
              <th className="px-3 py-2 text-left font-medium w-[120px]">Strategy</th>
              <th className="px-3 py-2 text-left font-medium">Adjustment rationale</th>
            </tr>
          </thead>
          <tbody>
            {withTab.map((r) => {
              const plan = planFor(r.sourceTab);
              const live = r.bcAccount != null ? liveBalances.get(String(r.bcAccount)) : undefined;
              const liveDiff =
                live !== undefined && r.unadjusted !== null
                  ? Math.abs(live - (r.unadjusted as number)) > 0.01
                  : false;
              return (
                <tr key={r.row} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">
                    {r.bcAccount ?? "—"}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="font-medium text-slate-900">{r.account}</div>
                    {plan && (
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            STATUS_META[plan.status].dot
                          }`}
                        />
                        {STATUS_META[plan.status].label}
                        <span className="text-slate-300">·</span>
                        {plan.sourceSystem}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                    {r.unadjusted !== null ? fmt(r.unadjusted as number) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    <span className={liveDiff ? "text-amber-700" : "text-slate-900"}>
                      {live !== undefined ? fmt(live) : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-700">{r.sourceTab}</td>
                  <td className="px-3 py-1.5">
                    {plan ? (
                      <span
                        className={`inline-block rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          STRATEGY_META[plan.strategy].className
                        }`}
                      >
                        {STRATEGY_META[plan.strategy].label}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="text-slate-700">{r.comment || "—"}</div>
                    {plan && plan.rationale && (
                      <div className="mt-0.5 text-[11px] text-slate-500">{plan.rationale}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        An <span className="text-amber-700">amber</span> value in <em>Unadj (BC live)</em> means
        BC&apos;s current balance differs from the Excel snapshot — expected if postings
        happened after the snapshot was taken.
      </p>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "slate";
}) {
  const cls = {
    emerald: "border-emerald-200 text-emerald-800",
    amber: "border-amber-200 text-amber-800",
    slate: "border-slate-200 text-slate-700",
  }[tone];
  return (
    <div className={`rounded border bg-white px-4 py-3 ${cls}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
