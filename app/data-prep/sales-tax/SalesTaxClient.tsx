"use client";

import { useMemo, useState } from "react";
import { fmt } from "@/lib/recon";

export type TaxTransactionRow = {
  docType: "Invoice" | "Credit Memo";
  docId: string;
  docNumber: string;
  docDate: string;
  customerId: string;
  customerNumber: string;
  customerName: string;
  state: string;
  city: string;
  taxAreaId: string;
  taxAreaDisplayName: string;
  taxCode: string;
  taxPercent: number;
  taxableAmount: number;
  taxAmount: number;
  description: string;
};

type TaxAreaRef = { code: string; displayName: string };
type TaxGroupRef = { code: string; displayName: string; taxType: string };

type GroupKey = "state" | "taxCode" | "customer";

type Props = {
  periodStart: string;
  periodEnd: string;
  rows: TaxTransactionRow[];
  taxAreas: TaxAreaRef[];
  taxGroups: TaxGroupRef[];
};

function pctFmt(n: number) {
  return `${n.toFixed(2)}%`;
}

export default function SalesTaxClient({
  periodStart,
  periodEnd,
  rows,
  taxAreas,
  taxGroups,
}: Props) {
  const [groupBy, setGroupBy] = useState<GroupKey>("state");
  const [expanded, setExpanded] = useState<string | null>(null);

  const totalTax = useMemo(() => rows.reduce((s, r) => s + r.taxAmount, 0), [rows]);
  const totalTaxable = useMemo(
    () => rows.reduce((s, r) => s + r.taxableAmount, 0),
    [rows]
  );
  const invoiceCount = useMemo(() => {
    const ids = new Set(rows.filter((r) => r.docType === "Invoice").map((r) => r.docId));
    return ids.size;
  }, [rows]);
  const cmCount = useMemo(() => {
    const ids = new Set(
      rows.filter((r) => r.docType === "Credit Memo").map((r) => r.docId)
    );
    return ids.size;
  }, [rows]);

  const groups = useMemo(() => {
    const m = new Map<
      string,
      { key: string; label: string; taxable: number; tax: number; rows: TaxTransactionRow[] }
    >();
    for (const r of rows) {
      let key: string;
      let label: string;
      if (groupBy === "state") {
        key = r.state || "—";
        label = r.state || "(no state)";
      } else if (groupBy === "taxCode") {
        key = r.taxCode || "—";
        label = r.taxCode || "(no tax code)";
      } else {
        key = r.customerId || r.customerNumber;
        label = r.customerName || r.customerNumber || "(unknown)";
      }
      let b = m.get(key);
      if (!b) {
        b = { key, label, taxable: 0, tax: 0, rows: [] };
        m.set(key, b);
      }
      b.taxable += r.taxableAmount;
      b.tax += r.taxAmount;
      b.rows.push(r);
    }
    return Array.from(m.values()).sort((a, b) => Math.abs(b.tax) - Math.abs(a.tax));
  }, [rows, groupBy]);

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-3">
        <Panel label="Tax Collected" value={fmt(totalTax)} tone="neutral" />
        <Panel label="Taxable Sales" value={fmt(totalTaxable)} tone="neutral" />
        <Panel
          label="Effective Rate"
          value={totalTaxable !== 0 ? pctFmt((totalTax / totalTaxable) * 100) : "—"}
          tone="neutral"
        />
        <Panel
          label="Documents"
          value={`${invoiceCount} inv · ${cmCount} cm`}
          tone="neutral"
        />
      </div>

      {/* Grouping selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-500">Group by:</span>
        {(["state", "taxCode", "customer"] as const).map((g) => (
          <button
            key={g}
            onClick={() => {
              setGroupBy(g);
              setExpanded(null);
            }}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              groupBy === g
                ? "bg-slate-800 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {g === "state" ? "State" : g === "taxCode" ? "Tax Code" : "Customer"}
          </button>
        ))}
      </div>

      {/* Grouped table */}
      <div className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
          Tax Collected — as of {periodEnd}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left font-medium w-[30px]"></th>
              <th className="px-4 py-2 text-left font-medium">
                {groupBy === "state" ? "State" : groupBy === "taxCode" ? "Tax Code" : "Customer"}
              </th>
              <th className="px-4 py-2 text-right font-medium">Taxable Sales</th>
              <th className="px-4 py-2 text-right font-medium">Tax Collected</th>
              <th className="px-4 py-2 text-right font-medium">% of Tax</th>
              <th className="px-4 py-2 text-right font-medium">Lines</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const pct = totalTax !== 0 ? (g.tax / totalTax) * 100 : 0;
              const isOpen = expanded === g.key;
              return (
                <>
                  <tr
                    key={g.key}
                    className="border-t border-slate-100 cursor-pointer hover:bg-slate-50"
                    onClick={() => setExpanded(isOpen ? null : g.key)}
                  >
                    <td className="px-4 py-1.5 text-center text-slate-400">
                      {isOpen ? "▾" : "▸"}
                    </td>
                    <td className="px-4 py-1.5">{g.label}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">
                      {fmt(g.taxable)}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums font-medium">
                      {fmt(g.tax)}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">
                      {pct.toFixed(2)}%
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">
                      {g.rows.length}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${g.key}-detail`} className="border-t border-slate-100 bg-slate-50/50">
                      <td></td>
                      <td colSpan={5} className="px-4 py-3">
                        <table className="w-full text-xs">
                          <thead className="text-slate-500">
                            <tr>
                              <th className="px-2 py-1 text-left font-medium">Doc #</th>
                              <th className="px-2 py-1 text-left font-medium">Type</th>
                              <th className="px-2 py-1 text-left font-medium">Date</th>
                              <th className="px-2 py-1 text-left font-medium">Customer</th>
                              <th className="px-2 py-1 text-left font-medium">State/City</th>
                              <th className="px-2 py-1 text-left font-medium">Tax Code</th>
                              <th className="px-2 py-1 text-right font-medium">Rate</th>
                              <th className="px-2 py-1 text-right font-medium">Taxable</th>
                              <th className="px-2 py-1 text-right font-medium">Tax</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.rows
                              .slice()
                              .sort((a, b) => Math.abs(b.taxAmount) - Math.abs(a.taxAmount))
                              .map((r, i) => (
                                <tr key={`${r.docId}-${i}`} className="border-t border-slate-200">
                                  <td className="px-2 py-1 font-mono text-[11px]">
                                    {r.docNumber}
                                  </td>
                                  <td className="px-2 py-1 text-slate-500">
                                    {r.docType === "Credit Memo" ? "CM" : "Inv"}
                                  </td>
                                  <td className="px-2 py-1 tabular-nums text-slate-500">
                                    {r.docDate}
                                  </td>
                                  <td className="px-2 py-1 max-w-[180px] truncate" title={r.customerName}>
                                    {r.customerName}
                                  </td>
                                  <td className="px-2 py-1 text-slate-500">
                                    {r.state}{r.city ? ` / ${r.city}` : ""}
                                  </td>
                                  <td className="px-2 py-1 font-mono text-[11px]">
                                    {r.taxCode}
                                  </td>
                                  <td className="px-2 py-1 text-right tabular-nums text-slate-500">
                                    {r.taxPercent ? pctFmt(r.taxPercent) : ""}
                                  </td>
                                  <td className="px-2 py-1 text-right tabular-nums">
                                    {fmt(r.taxableAmount)}
                                  </td>
                                  <td className="px-2 py-1 text-right tabular-nums font-medium">
                                    {fmt(r.taxAmount)}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
              <td></td>
              <td className="px-4 py-1.5">Total</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(totalTaxable)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(totalTax)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">100.00%</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{rows.length}</td>
            </tr>
          </tbody>
        </table>
        {groups.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            No sales tax recorded in this period.
          </div>
        )}
      </div>

      {/* Setup reference */}
      <details className="rounded border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-slate-900">
          BC tax setup reference ({taxAreas.length} tax areas · {taxGroups.length} tax groups)
        </summary>
        <div className="grid grid-cols-2 gap-px bg-slate-200">
          <div className="bg-white">
            <div className="border-b border-slate-200 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Tax Areas
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium w-[120px]">Code</th>
                  <th className="px-3 py-1.5 text-left font-medium">Display name</th>
                </tr>
              </thead>
              <tbody>
                {taxAreas.map((a) => (
                  <tr key={a.code} className="border-t border-slate-100">
                    <td className="px-3 py-1 font-mono text-[11px]">{a.code}</td>
                    <td className="px-3 py-1">{a.displayName}</td>
                  </tr>
                ))}
                {taxAreas.length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-3 py-4 text-center text-xs text-slate-500">
                      No tax areas configured
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="bg-white">
            <div className="border-b border-slate-200 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Tax Groups
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium w-[120px]">Code</th>
                  <th className="px-3 py-1.5 text-left font-medium">Display name</th>
                  <th className="px-3 py-1.5 text-left font-medium w-[90px]">Type</th>
                </tr>
              </thead>
              <tbody>
                {taxGroups.map((g) => (
                  <tr key={g.code} className="border-t border-slate-100">
                    <td className="px-3 py-1 font-mono text-[11px]">{g.code}</td>
                    <td className="px-3 py-1">{g.displayName}</td>
                    <td className="px-3 py-1 text-slate-500 text-xs">{g.taxType}</td>
                  </tr>
                ))}
                {taxGroups.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-xs text-slate-500">
                      No tax groups configured
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <div className="border-t border-slate-200 pt-4 text-xs text-slate-500">
        Period: {periodStart} → {periodEnd}
      </div>
    </div>
  );
}

function Panel({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
      ? "text-amber-700"
      : "text-slate-900";
  return (
    <div className="rounded border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}
