import Link from "next/link";
import { redirect } from "next/navigation";
import { accounts, sections, fmt, type Account } from "@/lib/recon";
import { loadBalances, balanceOf } from "@/lib/balances";
import { getEntityConfig } from "@/lib/settings";
import MetricCard from "@/components/MetricCard";

export const dynamic = "force-dynamic";

type Row = Account & { balance: number };

export default async function Home() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");

  const balances = await loadBalances();

  const withBalance = (a: Account): Row => ({ ...a, balance: balanceOf(balances, a.name) });
  const assets = accounts.filter((a) => a.classification === "Assets").map(withBalance);
  const liabilities = accounts.filter((a) => a.classification === "Liabilities").map(withBalance);
  const equity = accounts.filter((a) => a.classification === "Equity").map(withBalance);

  const sum = (rows: Row[]) => rows.reduce((s, r) => s + r.balance, 0);
  const totalAssets = sum(assets);
  const totalLiab = sum(liabilities);
  const totalEquity = sum(equity);
  const check = totalAssets + totalLiab + totalEquity;

  return (
    <div className="px-8 py-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">Balance Sheet Summary</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          {entity.name || "Unconfigured entity"}
        </h1>
        <div className="mt-0.5 text-sm text-slate-600">
          Unadjusted trial balance — {entity.periodEnd || "no period set"}
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3 mb-8">
        <MetricCard label="Total Assets" value={fmt(totalAssets)} />
        <MetricCard label="Total Liabilities + Equity" value={fmt(-(totalLiab + totalEquity))} />
        <MetricCard
          label="Check (A − L − E)"
          value={fmt(check)}
          tone={Math.abs(check) < 1 ? "ok" : "warn"}
        />
      </div>

      <BsSection title="Assets" rows={assets} />
      <BsSection title="Liabilities" rows={liabilities} />
      <BsSection title="Equity" rows={equity} />

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


function BsSection({ title, rows }: { title: string; rows: Row[] }) {
  const total = rows.reduce((s, r) => s + r.balance, 0);
  return (
    <div className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      <div className="overflow-hidden rounded border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Account</th>
              <th className="px-4 py-2 text-left font-medium">FS Mapping</th>
              <th className="px-4 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-slate-100">
                <td className="px-4 py-1.5">{r.name}</td>
                <td className="px-4 py-1.5 text-slate-500">{r.fsMapping || "—"}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {r.balance === 0 ? "–" : fmt(r.balance)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
              <td className="px-4 py-1.5" colSpan={2}>
                Total {title}
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
