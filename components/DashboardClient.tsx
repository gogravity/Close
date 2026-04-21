"use client";

import { useState } from "react";
import Link from "next/link";
import { fmt } from "@/lib/recon";

export type RowData = {
  name: string;
  classification: "Assets" | "Liabilities" | "Equity";
  subclassification?: string;
  fsMapping?: string;
  balance: number;
  adjustment: number;
};

export type SectionStatus = {
  slug: string;
  title: string;
  order: number;
  accountNames: string[];
  hasAdjustment: boolean;
};

type Props = {
  assets: RowData[];
  liabilities: RowData[];
  equity: RowData[];
  sectionStatuses: SectionStatus[];
  syncMeta: { syncedAt: string; asOf: string } | null;
};

export default function DashboardClient({
  assets,
  liabilities,
  equity,
  sectionStatuses,
  syncMeta,
}: Props) {
  const [verifyMode, setVerifyMode] = useState(false);

  // Accounts that belong to a section with no adjustment yet
  const missingSections = sectionStatuses.filter((s) => !s.hasAdjustment);
  const missingAccountNames = new Set(missingSections.flatMap((s) => s.accountNames));
  const completeSections = sectionStatuses.filter((s) => s.hasAdjustment);

  const sumBal = (rows: RowData[]) => rows.reduce((s, r) => s + r.balance, 0);
  const sumAdj = (rows: RowData[]) => rows.reduce((s, r) => s + r.adjustment, 0);

  const totalAssets = sumBal(assets);
  const totalLiab = sumBal(liabilities);
  const totalEquity = sumBal(equity);
  const check = totalAssets + totalLiab + totalEquity;

  return (
    <>
      {/* Sync metadata + verify controls */}
      <div className="mb-6 flex items-center justify-between">
        <div className="text-xs text-slate-400">
          {syncMeta ? (
            <>
              <span className="font-medium text-slate-500">Snapshot as of {syncMeta.asOf}</span>
              {" · "}
              Synced {new Date(syncMeta.syncedAt).toLocaleString()}
            </>
          ) : (
            <span className="text-slate-400 italic">No snapshot — click Sync Data to pull from Business Central</span>
          )}
        </div>

        <button
          onClick={() => setVerifyMode((v) => !v)}
          className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
            verifyMode
              ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300 hover:bg-amber-200"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          {verifyMode ? "Exit Verify" : "Verify"}
          {!verifyMode && missingSections.length > 0 && (
            <span className="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {missingSections.length}
            </span>
          )}
        </button>
      </div>

      {/* Verify panel */}
      {verifyMode && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-semibold text-amber-900">
              Journal Entry Status —{" "}
              {completeSections.length} of {sectionStatuses.length} sections complete
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            {sectionStatuses.map((s) => (
              <Link
                key={s.slug}
                href={`/section/${s.slug}`}
                className="flex items-center gap-2 text-sm hover:underline"
              >
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    s.hasAdjustment ? "bg-emerald-500" : "bg-amber-400"
                  }`}
                />
                <span className={s.hasAdjustment ? "text-slate-600" : "font-medium text-amber-800"}>
                  {s.order}. {s.title}
                </span>
                {!s.hasAdjustment && (
                  <span className="text-[10px] text-amber-600 uppercase tracking-wide">
                    missing JE
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <MetricCard label="Total Assets" value={fmt(totalAssets)} />
        <MetricCard
          label="Total Liabilities + Equity"
          value={fmt(-(totalLiab + totalEquity))}
        />
        <MetricCard
          label="Check (A − L − E)"
          value={fmt(check)}
          tone={Math.abs(check) < 1 ? "ok" : "warn"}
        />
      </div>

      {/* Balance sheet tables */}
      <BsSection
        title="Assets"
        rows={assets}
        verifyMode={verifyMode}
        missingAccountNames={missingAccountNames}
      />
      <BsSection
        title="Liabilities"
        rows={liabilities}
        verifyMode={verifyMode}
        missingAccountNames={missingAccountNames}
      />
      <BsSection
        title="Equity"
        rows={equity}
        verifyMode={verifyMode}
        missingAccountNames={missingAccountNames}
      />
    </>
  );
}

/* ── Inline MetricCard (avoids server-component import issues) ── */
function MetricCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  const accentBar =
    tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-transparent";
  const valueColor =
    tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-slate-900";

  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className={`absolute inset-y-0 left-0 w-[3px] ${accentBar}`} />
      <div className="px-4 py-3 pl-5">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          {label}
        </div>
        <div className={`mt-1.5 text-xl font-semibold tabular-nums leading-none ${valueColor}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

/* ── Balance sheet section table ── */
function BsSection({
  title,
  rows,
  verifyMode,
  missingAccountNames,
}: {
  title: string;
  rows: RowData[];
  verifyMode: boolean;
  missingAccountNames: Set<string>;
}) {
  const totalBal = rows.reduce((s, r) => s + r.balance, 0);
  const totalAdj = rows.reduce((s, r) => s + r.adjustment, 0);
  const totalAdjusted = totalBal + totalAdj;
  const hasAnyAdj = rows.some((r) => r.adjustment !== 0);

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
              <th className="px-4 py-2 text-right font-medium">Unadjusted Trial Balance</th>
              <th className="px-4 py-2 text-right font-medium text-slate-400">Adjustments</th>
              <th className="px-4 py-2 text-right font-medium">Adjusted Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const adjusted = r.balance + r.adjustment;
              const isMissing = verifyMode && missingAccountNames.has(r.name);
              return (
                <tr
                  key={r.name}
                  className={`border-t border-slate-100 transition-colors ${
                    isMissing ? "bg-amber-50" : ""
                  }`}
                >
                  <td className="px-4 py-1.5">
                    <span className={isMissing ? "font-medium text-amber-800" : ""}>{r.name}</span>
                    {isMissing && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                        pending JE
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums">
                    {r.balance === 0 ? "–" : fmt(r.balance)}
                  </td>
                  <td
                    className={`px-4 py-1.5 text-right tabular-nums ${
                      r.adjustment !== 0 ? "text-amber-700" : "text-slate-300"
                    }`}
                  >
                    {r.adjustment === 0 ? "–" : fmt(r.adjustment)}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums font-medium">
                    {adjusted === 0 ? "–" : fmt(adjusted)}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
              <td className="px-4 py-1.5">
                Total {title}
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(totalBal)}</td>
              <td
                className={`px-4 py-1.5 text-right tabular-nums ${
                  hasAnyAdj ? "text-amber-700" : "text-slate-300"
                }`}
              >
                {totalAdj === 0 ? "–" : fmt(totalAdj)}
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(totalAdjusted)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
