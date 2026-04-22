"use client";

import React, { useState, useCallback } from "react";
import MetricCard from "@/components/MetricCard";
import type { ChecklistResponse, ChecklistItemResult } from "@/app/api/expense-checklist/route";

type Props = {
  defaultYear: number;
  defaultMonth: number;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const FREQ_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  "semi-annually": "Semi-annual",
  annually: "Annual",
  various: "Various",
};

function StatusChip({ status }: { status: ChecklistItemResult["status"] }) {
  if (status === "found") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <svg className="size-3" viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Found
      </span>
    );
  }
  if (status === "missing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-300">
        <svg className="size-3" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 3.5v3M6 8v.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
        Not in AP
      </span>
    );
  }
  if (status === "not-expected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
        <svg className="size-3" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        Not this period
      </span>
    );
  }
  // informational (various)
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
      Various
    </span>
  );
}

function rowBg(status: ChecklistItemResult["status"], expanded: boolean): string {
  if (status === "missing") return expanded ? "bg-amber-50/60" : "hover:bg-amber-50/40";
  if (status === "found") return expanded ? "bg-emerald-50/40" : "hover:bg-slate-50";
  if (status === "not-expected") return "hover:bg-slate-50";
  return "hover:bg-slate-50";
}

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function dayLabel(day: number | null): string {
  if (day === null) return "—";
  const s = day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th";
  return `${day}${s}`;
}

export default function ExpenseChecklistClient({ defaultYear, defaultMonth }: Props) {
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ChecklistResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "missing" | "found">("all");

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExpanded(new Set());
    try {
      const res = await fetch(`/api/expense-checklist?year=${year}&month=${month}`);
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Unknown error");
        setResult(null);
      } else {
        setResult(json as ChecklistResponse);
      }
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Year options: past 3 years + current
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 2, currentYear - 1, currentYear];

  const visibleResults = result
    ? result.results.filter((r) => {
        if (filter === "missing") return r.status === "missing" || r.status === "not-expected";
        if (filter === "found") return r.status === "found";
        return true;
      })
    : [];

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Month
          </label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>{name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Year
          </label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <button
          onClick={run}
          disabled={loading}
          className="h-9 rounded-md bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Checking…" : "Run Check"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Total Items" value={result.totalItems} tone="neutral" />
            <MetricCard
              label="Found in BC"
              value={result.found}
              tone={result.found === result.totalItems - result.notExpected ? "ok" : "neutral"}
            />
            <MetricCard
              label="Not in AP"
              value={result.missing}
              tone={result.missing > 0 ? "warn" : "ok"}
            />
            <MetricCard
              label="Not Expected / Various"
              value={result.notExpected}
              tone="neutral"
            />
          </div>

          {/* Not-in-AP banner */}
          {result.missing > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <svg className="mt-0.5 size-5 shrink-0 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="text-sm font-medium text-amber-900">
                  {result.missing} monthly {result.missing === 1 ? "item" : "items"} not found in BC AP for {result.periodLabel}
                </p>
                <p className="mt-0.5 text-xs text-amber-700">
                  These may be credit card charges, manual JEs, or genuinely unposted — verify each one manually.
                </p>
              </div>
            </div>
          )}

          {result.missing === 0 && result.found > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <svg className="size-5 shrink-0 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
              <p className="text-sm font-medium text-emerald-800">
                All expected monthly expenses found for {result.periodLabel}
              </p>
            </div>
          )}

          {/* Filter bar */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Show:</span>
            {(["all", "missing", "found"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filter === f
                    ? "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {f === "all" ? "All" : f === "missing" ? "Not in AP" : "Found in AP"}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 w-5"></th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Vendor</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Exp. Day</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Frequency</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Status</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Amount</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleResults.map((r) => {
                  const isOpen = expanded.has(r.item.id);
                  const hasMatches = r.matches.length > 0;
                  const totalAmount = r.matches.reduce((s, m) => s + m.amount, 0);

                  return (
                    <React.Fragment key={r.item.id}>
                      {/* Main row */}
                      <tr
                        onClick={() => hasMatches && toggleExpand(r.item.id)}
                        className={`transition-colors ${rowBg(r.status, isOpen)} ${hasMatches ? "cursor-pointer" : ""}`}
                      >
                        {/* Expand toggle */}
                        <td className="px-4 py-3 text-slate-400 text-xs">
                          {hasMatches ? (
                            <span>{isOpen ? "▾" : "▸"}</span>
                          ) : null}
                        </td>

                        {/* Vendor */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-medium ${
                                r.status === "missing"
                                  ? "text-amber-900"
                                  : "text-slate-800"
                              }`}
                            >
                              {r.item.vendor}
                            </span>
                            {r.item.isJournalEntry && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                                JE
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Day */}
                        <td className="px-4 py-3 text-center tabular-nums text-slate-500">
                          {dayLabel(r.item.dayOfMonth)}
                        </td>

                        {/* Frequency */}
                        <td className="px-4 py-3 text-center">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                            {FREQ_LABELS[r.item.frequency] ?? r.item.frequency}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3 text-center">
                          <StatusChip status={r.status} />
                        </td>

                        {/* Amount */}
                        <td className="px-4 py-3 text-right tabular-nums">
                          {r.status === "found" ? (
                            <span className="text-slate-700">{formatAmount(totalAmount)}</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        {/* Notes */}
                        <td className="px-4 py-3 text-xs text-slate-400 max-w-[200px]">
                          {r.item.notes}
                        </td>
                      </tr>

                      {/* Expanded invoice detail */}
                      {isOpen && r.matches.length > 0 && (
                        <tr className="bg-emerald-50/60">
                          <td colSpan={7} className="px-8 pb-3 pt-1">
                            <div className="rounded-md border border-emerald-100 bg-white overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-slate-100 bg-slate-50 text-left">
                                    <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Invoice #</th>
                                    <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Vendor Name</th>
                                    <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Date</th>
                                    <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Amount</th>
                                    <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Status</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                  {r.matches.map((m) => (
                                    <tr key={m.invoiceNumber} className="text-slate-700">
                                      <td className="px-3 py-2 font-mono">{m.invoiceNumber}</td>
                                      <td className="px-3 py-2">{m.vendorName}</td>
                                      <td className="px-3 py-2 tabular-nums">{m.invoiceDate.slice(0, 10)}</td>
                                      <td className="px-3 py-2 text-right tabular-nums">{formatAmount(m.amount)}</td>
                                      <td className="px-3 py-2 text-center">
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                          {m.bcStatus}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            {visibleResults.length === 0 && (
              <div className="py-12 text-center text-sm text-slate-400">
                No results match the current filter.
              </div>
            )}
          </div>

          <p className="text-xs text-slate-400">
            Matched against BC purchase invoices (AP) for {result.periodLabel}. Expenses paid via credit card, manual JEs, or distributor bundles (e.g. Pax8) will show &ldquo;Not in AP&rdquo; even when correctly posted — those require manual verification.
          </p>
        </>
      )}

      {!result && !loading && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 py-16 text-center">
          <svg className="mb-3 size-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <p className="text-sm font-medium text-slate-500">Select a month and run the check</p>
          <p className="mt-1 text-xs text-slate-400">
            Verifies {new Date().getFullYear()} recurring expenses against BC purchase invoices
          </p>
        </div>
      )}
    </div>
  );
}
