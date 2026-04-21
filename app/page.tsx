import Link from "next/link";
import { redirect } from "next/navigation";
import { accounts, sections, type Account } from "@/lib/recon";
import { loadBalances, balanceOf, loadSyncMeta } from "@/lib/balances";
import { loadAdjustmentsByAccount, adjustmentFor } from "@/lib/adjustments";
import { getEntityConfig } from "@/lib/settings";
import MonthEndPicker from "@/components/MonthEndPicker";
import DashboardClient, { type RowData, type SectionStatus } from "@/components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");

  const [balances, syncMeta] = await Promise.all([
    loadBalances(),
    loadSyncMeta(),
  ]);

  // Use the frozen snapshot period if available, otherwise fall back to entity setting
  const period = (syncMeta?.asOf ?? entity.periodEnd ?? "").slice(0, 7); // YYYY-MM
  const adjMap = await loadAdjustmentsByAccount(period);

  const toRow = (a: Account): RowData => ({
    name: a.name,
    classification: a.classification,
    subclassification: a.subclassification,
    fsMapping: a.fsMapping,
    balance: balanceOf(balances, a.name),
    adjustment: adjustmentFor(adjMap, a.name),
  });

  const assets = accounts.filter((a) => a.classification === "Assets").map(toRow);
  const liabilities = accounts.filter((a) => a.classification === "Liabilities").map(toRow);
  const equity = accounts.filter((a) => a.classification === "Equity").map(toRow);

  // Verify status: a section "has adjustment" only if a JE has been explicitly confirmed
  const sectionStatuses: SectionStatus[] = sections.map((s) => {
    const hasAdjustment = s.accounts.some((name) => adjustmentFor(adjMap, name) !== 0);
    return {
      slug: s.slug,
      title: s.title,
      order: s.order,
      accountNames: s.accounts,
      hasAdjustment,
    };
  });

  return (
    <div className="px-8 py-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">Balance Sheet Summary</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          {entity.name || "Unconfigured entity"}
        </h1>
        <MonthEndPicker initialPeriod={entity.periodEnd} />
      </header>

      <DashboardClient
        assets={assets}
        liabilities={liabilities}
        equity={equity}
        sectionStatuses={sectionStatuses}
        syncMeta={syncMeta}
      />

      <div className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">
          Reconciliation sections
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {sections.map((s) => {
            const planned = s.dataSources.filter((d) => d.status === "planned").length;
            return (
              <Link
                key={s.slug}
                href={`/section/${s.slug}`}
                className="block rounded border border-slate-200 px-4 py-3 hover:border-slate-400 hover:bg-slate-50"
              >
                <div className="text-xs text-slate-500">Section {s.order}</div>
                <div className="font-medium text-slate-900">{s.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {s.dataSources.length} source{s.dataSources.length === 1 ? "" : "s"} ·{" "}
                  {planned} API integration{planned === 1 ? "" : "s"} to build
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
