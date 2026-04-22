"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import MetricCard from "@/components/MetricCard";
import type { ChecklistResponse, ChecklistErrorResponse } from "@/app/api/expense-checklist/route";
import type { BcAccountsResponse, BcAccountEntry } from "@/app/api/bc-accounts/route";
import type {
  VerifiedVendor,
  VerifiedJournalPattern,
  PossiblyNewVendor,
  PossiblyNewGlPattern,
} from "@/lib/recurringExpenses";

type Props = { defaultYear: number; defaultMonth: number };

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function fmtYM(ym: string): string {
  // "2025-03" → "March 2025"
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

const FREQ_BADGE: Record<string, { label: string; cls: string }> = {
  monthly:    { label: "Monthly",    cls: "bg-blue-50 text-blue-700 ring-blue-200" },
  frequent:   { label: "Frequent",   cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  quarterly:  { label: "Quarterly",  cls: "bg-purple-50 text-purple-700 ring-purple-200" },
  occasional: { label: "Occasional", cls: "bg-slate-100 text-slate-500 ring-slate-200" },
};

function FreqBadge({ freq }: { freq: string }) {
  const b = FREQ_BADGE[freq] ?? FREQ_BADGE.occasional;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${b.cls}`}>
      {b.label}
    </span>
  );
}

function SourceBadge({ source }: { source: "ap" | "gl" }) {
  return source === "ap" ? (
    <span className="inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200">
      AP
    </span>
  ) : (
    <span className="inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-violet-50 text-violet-600 ring-1 ring-inset ring-violet-200">
      GL
    </span>
  );
}

function StatusChip({ status, expectedThisMonth }: { status: "found" | "absent"; expectedThisMonth: boolean }) {
  if (status === "found") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <svg className="size-3" viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Found
      </span>
    );
  }
  if (expectedThisMonth) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-300">
        <svg className="size-3" viewBox="0 0 12 12" fill="none">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        Missing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
      Not expected
    </span>
  );
}

function vendorRowBg(v: VerifiedVendor, expanded: boolean): string {
  if (v.status === "found")    return expanded ? "bg-emerald-50/40" : "hover:bg-slate-50";
  if (v.expectedThisMonth)     return expanded ? "bg-red-50" : "bg-red-50/60 hover:bg-red-50";
  return "hover:bg-slate-50";
}

function glRowBg(p: VerifiedJournalPattern, expanded: boolean): string {
  if (p.status === "found")    return expanded ? "bg-emerald-50/40" : "hover:bg-slate-50";
  if (p.expectedThisMonth)     return expanded ? "bg-red-50" : "bg-red-50/60 hover:bg-red-50";
  return "hover:bg-slate-50";
}

function fmtAmount(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function dayLabel(day: number | null) {
  if (day === null) return "—";
  const s = day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th";
  return `${day}${s}`;
}

/** Dot strip for the last 6 months of the lookback, ending at lookbackEndYM. */
function MonthDots({ seenIn, lookbackEndYM }: { seenIn: string[]; lookbackEndYM: string }) {
  const seenSet = new Set(seenIn);
  const [ey, em] = lookbackEndYM.split("-").map(Number);
  const dots: { ym: string; label: string; present: boolean }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(ey, em - 1 - i, 1));
    const ym = d.toISOString().slice(0, 7);
    const label = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    dots.push({ ym, label, present: seenSet.has(ym) });
  }
  return (
    <div className="flex items-center gap-0.5" title={seenIn.join(", ")}>
      {dots.map(({ ym, label, present }) => (
        <div
          key={ym}
          title={ym}
          className={`size-2 rounded-full ${present ? "bg-blue-500" : "bg-slate-200"}`}
          aria-label={`${label}: ${present ? "seen" : "not seen"}`}
        />
      ))}
    </div>
  );
}

// ── Shared mini invoice table ─────────────────────────────────────────────────

function InvoiceTable({ invoices }: {
  invoices: { invoiceNumber: string; invoiceDate?: string; vendorName?: string; amount: number; bcStatus: string }[];
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-slate-100 bg-slate-50 text-left">
          <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Invoice #</th>
          <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Date</th>
          <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Amount</th>
          <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {invoices.map((inv) => (
          <tr key={inv.invoiceNumber} className="text-slate-700">
            <td className="px-3 py-2 font-mono">{inv.invoiceNumber}</td>
            <td className="px-3 py-2 tabular-nums">{(inv.invoiceDate ?? "").slice(0, 10)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtAmount(inv.amount)}</td>
            <td className="px-3 py-2 text-center">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {inv.bcStatus}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Accounts dropdown ─────────────────────────────────────────────────────────

type AccountsDropdownProps = {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
};

function AccountsDropdown({ selected, onChange }: AccountsDropdownProps) {
  const [open, setOpen]         = useState(false);
  const [accounts, setAccounts] = useState<BcAccountEntry[]>([]);
  const [loading, setLoading]   = useState(false);
  const [fetched, setFetched]   = useState(false);
  const [search, setSearch]     = useState("");
  const panelRef                = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function fetchAccounts() {
    if (fetched) return;
    setLoading(true);
    try {
      const res  = await fetch("/api/bc-accounts");
      const json = await res.json() as BcAccountsResponse | { ok: false; error: string };
      if (json.ok) {
        setAccounts((json as BcAccountsResponse).accounts);
        const allNumbers = new Set(
          (json as BcAccountsResponse).accounts
            .filter((a) => a.category === "Expense")
            .map((a) => a.number)
        );
        onChange(allNumbers);
      }
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }

  function handleOpen() {
    setOpen((v) => !v);
    fetchAccounts();
  }

  function toggle(number: string) {
    const next = new Set(selected);
    next.has(number) ? next.delete(number) : next.add(number);
    onChange(next);
  }

  function selectAll(category?: string) {
    const next = new Set(selected);
    for (const a of accounts) if (!category || a.category === category) next.add(a.number);
    onChange(next);
  }

  function clearAll(category?: string) {
    const next = new Set(selected);
    for (const a of accounts) if (!category || a.category === category) next.delete(a.number);
    onChange(next);
  }

  const filtered = accounts.filter(
    (a) => !search || a.displayName.toLowerCase().includes(search.toLowerCase()) || a.number.includes(search)
  );
  const byCategory = filtered.reduce<Record<string, BcAccountEntry[]>>((acc, a) => {
    (acc[a.category] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={handleOpen}
        className="flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <svg className="size-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M6 12h12M9 17h6" />
        </svg>
        <span>
          Accounts
          {selected.size > 0 && (
            <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
              {selected.size}
            </span>
          )}
        </span>
        <svg className={`size-3 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-10 z-20 w-80 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-xs font-semibold text-slate-600">BC Expense Accounts</span>
            <div className="flex gap-2">
              <button onClick={() => selectAll()} className="text-[10px] text-blue-600 hover:underline">All</button>
              <button onClick={() => clearAll()} className="text-[10px] text-slate-400 hover:underline">None</button>
            </div>
          </div>
          <div className="border-b border-slate-100 px-3 py-2">
            <input
              type="text"
              placeholder="Filter accounts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {loading && <div className="py-6 text-center text-xs text-slate-400">Loading accounts…</div>}
            {!loading && Object.entries(byCategory).map(([cat, list]) => (
              <div key={cat}>
                <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{cat}</span>
                  <div className="flex gap-2">
                    <button onClick={() => selectAll(cat)} className="text-[10px] text-blue-500 hover:underline">All</button>
                    <button onClick={() => clearAll(cat)} className="text-[10px] text-slate-400 hover:underline">None</button>
                  </div>
                </div>
                {list.map((a) => (
                  <label key={a.number} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={selected.has(a.number)}
                      onChange={() => toggle(a.number)}
                      className="size-3.5 rounded border-slate-300 accent-blue-600"
                    />
                    <span className="font-mono text-[10px] text-slate-400 shrink-0">{a.number}</span>
                    <span className="truncate text-xs text-slate-700">{a.displayName}</span>
                  </label>
                ))}
              </div>
            ))}
            {!loading && accounts.length > 0 && filtered.length === 0 && (
              <div className="py-4 text-center text-xs text-slate-400">No accounts match</div>
            )}
          </div>
          <div className="border-t border-slate-100 px-3 py-2 text-[10px] text-slate-400">
            {selected.size} of {accounts.length} selected
          </div>
        </div>
      )}
    </div>
  );
}

// ── Possibly-new AP vendors ───────────────────────────────────────────────────

function PossiblyNewSection({ vendors, periodLabel }: { vendors: PossiblyNewVendor[]; periodLabel: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (vendors.length === 0) return null;

  function toggle(v: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-700">New AP vendors this period</h3>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
          {vendors.length} vendor{vendors.length !== 1 ? "s" : ""}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        These vendors have invoices in {periodLabel} but no AP history in the lookback window.
        They may be new recurring expenses — verify whether they should be expected every month.
      </p>
      <div className="overflow-hidden rounded-lg border border-amber-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-amber-100 bg-amber-50 text-left">
              <th className="w-4 px-3 py-2" />
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-amber-700">Vendor</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-amber-700 text-right">Amount</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-amber-700 text-center">Invoices</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-50">
            {vendors.map((v) => {
              const isOpen = expanded.has(v.vendor);
              return (
                <React.Fragment key={v.vendor}>
                  <tr onClick={() => toggle(v.vendor)} className="cursor-pointer hover:bg-amber-50/40 transition-colors">
                    <td className="px-3 py-2.5 text-xs text-slate-400">{isOpen ? "▾" : "▸"}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{v.vendor}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{fmtAmount(v.totalAmount)}</td>
                    <td className="px-4 py-2.5 text-center tabular-nums text-slate-500">{v.invoices.length}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-amber-50/30">
                      <td colSpan={4} className="px-8 pb-3 pt-1">
                        <div className="overflow-hidden rounded-md border border-amber-100 bg-white">
                          <InvoiceTable invoices={v.invoices} />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Possibly-new GL patterns ──────────────────────────────────────────────────

function PossiblyNewGlSection({ patterns, periodLabel }: { patterns: PossiblyNewGlPattern[]; periodLabel: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (patterns.length === 0) return null;

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-700">New GL entries this period</h3>
        <SourceBadge source="gl" />
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
          {patterns.length} pattern{patterns.length !== 1 ? "s" : ""}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        Journal entries in {periodLabel} on selected accounts that don&apos;t match any recurring pattern in the lookback window.
        These could be new recurring expenses (new rent, new insurance policy, etc.) — verify whether they&apos;ll recur.
      </p>
      <div className="overflow-hidden rounded-lg border border-amber-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-amber-100 bg-amber-50 text-left">
              <th className="w-4 px-3 py-2" />
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-amber-700">Description</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-amber-700">Account</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-amber-700 text-right">Total debit</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-amber-700 text-center">Entries</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-50">
            {patterns.map((p) => {
              const key    = `${p.accountNumber}|${p.description}`;
              const isOpen = expanded.has(key);
              return (
                <React.Fragment key={key}>
                  <tr onClick={() => toggle(key)} className="cursor-pointer hover:bg-amber-50/40 transition-colors">
                    <td className="px-3 py-2.5 text-xs text-slate-400">{isOpen ? "▾" : "▸"}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{p.rawDescription}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-slate-400">{p.accountNumber}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{fmtAmount(p.totalDebit)}</td>
                    <td className="px-4 py-2.5 text-center tabular-nums text-slate-500">{p.currentMonthEntries.length}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-amber-50/30">
                      <td colSpan={5} className="px-8 pb-3 pt-1">
                        <div className="overflow-hidden rounded-md border border-amber-100 bg-white">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-slate-100 bg-slate-50 text-left">
                                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Date</th>
                                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Description</th>
                                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Debit</th>
                                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Credit</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {p.currentMonthEntries.map((e, i) => (
                                <tr key={i} className="text-slate-700">
                                  <td className="px-3 py-2 tabular-nums">{e.postingDate.slice(0, 10)}</td>
                                  <td className="px-3 py-2">{e.description}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{e.debitAmount > 0 ? fmtAmount(e.debitAmount) : "—"}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{e.creditAmount > 0 ? fmtAmount(e.creditAmount) : "—"}</td>
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
      </div>
    </div>
  );
}

// ── GL journal patterns section ───────────────────────────────────────────────

type GlFilterMode = "all" | "missing" | "found";

function GlPatternsSection({ patterns, lookbackEndYM }: {
  patterns: VerifiedJournalPattern[];
  lookbackEndYM: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter]     = useState<GlFilterMode>("all");

  if (patterns.length === 0) return null;

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const visible = patterns.filter((p) => {
    if (filter === "missing") return p.status === "absent" && p.expectedThisMonth;
    if (filter === "found")   return p.status === "found";
    return true;
  });

  const missingCount = patterns.filter((p) => p.status === "absent" && p.expectedThisMonth).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-700">GL Journal Patterns</h3>
        <SourceBadge source="gl" />
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
          {patterns.length} pattern{patterns.length !== 1 ? "s" : ""}
        </span>
        {missingCount > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
            {missingCount} missing
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Recurring journal entries detected across selected GL accounts — payroll, rent accruals, amortisation, etc.
        Payments and AP invoice lines are excluded.
      </p>

      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400">Show:</span>
        {(["all", "missing", "found"] as GlFilterMode[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === f ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f === "all" ? "All" : f === "missing" ? "Missing" : "Found"}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="w-4 px-3 py-3" />
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Description</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Account</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Frequency</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center" title="Last 6 months of lookback">Hist.</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Typical day</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Avg / mo</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((p) => {
              const rowKey     = `${p.accountNumber}|${p.description}`;
              const isOpen     = expanded.has(rowKey);
              const hasEntries = p.currentMonthEntries.length > 0;
              return (
                <React.Fragment key={rowKey}>
                  <tr
                    onClick={() => hasEntries && toggleExpand(rowKey)}
                    className={`transition-colors ${glRowBg(p, isOpen)} ${hasEntries ? "cursor-pointer" : ""}`}
                  >
                    <td className="px-3 py-3 text-xs text-slate-400">
                      {hasEntries ? (isOpen ? "▾" : "▸") : null}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-medium ${p.status === "absent" && p.expectedThisMonth ? "text-red-800" : "text-slate-800"}`}
                        title={p.rawDescription}
                      >
                        {p.rawDescription}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-slate-400">{p.accountNumber}</td>
                    <td className="px-4 py-3 text-center"><FreqBadge freq={p.frequency} /></td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center">
                        <MonthDots seenIn={p.seenInMonths} lookbackEndYM={lookbackEndYM} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-xs text-slate-500">{dayLabel(p.typicalDay)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs text-slate-600">{fmtAmount(p.avgMonthlyAmount)}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusChip status={p.status} expectedThisMonth={p.expectedThisMonth} />
                    </td>
                  </tr>
                  {isOpen && hasEntries && (
                    <tr className="bg-emerald-50/50">
                      <td colSpan={8} className="px-8 pb-3 pt-1">
                        <div className="overflow-hidden rounded-md border border-emerald-100 bg-white">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-slate-100 bg-slate-50 text-left">
                                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Date</th>
                                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Description</th>
                                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Debit</th>
                                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Credit</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {p.currentMonthEntries.map((e, i) => (
                                <tr key={i} className="text-slate-700">
                                  <td className="px-3 py-2 tabular-nums">{e.postingDate.slice(0, 10)}</td>
                                  <td className="px-3 py-2">{e.description}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{e.debitAmount > 0 ? fmtAmount(e.debitAmount) : "—"}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{e.creditAmount > 0 ? fmtAmount(e.creditAmount) : "—"}</td>
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
        {visible.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-400">No GL patterns match the current filter.</div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type FilterMode = "all" | "missing" | "found";

export default function ExpenseChecklistClient({ defaultYear, defaultMonth }: Props) {
  const [year, setYear]         = useState(defaultYear);
  const [month, setMonth]       = useState(defaultMonth);
  const [lookback, setLookback] = useState(6);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<ChecklistResponse | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter]     = useState<FilterMode>("all");
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExpanded(new Set());
    try {
      const accountsParam = selectedAccounts.size > 0
        ? `&accounts=${[...selectedAccounts].join(",")}`
        : "";
      const res  = await fetch(
        `/api/expense-checklist?year=${year}&month=${month}&lookback=${lookback}${accountsParam}`
      );
      const json = await res.json() as ChecklistResponse | ChecklistErrorResponse;
      if (!json.ok) {
        setError((json as ChecklistErrorResponse).error ?? "Unknown error");
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
  }, [year, month, lookback, selectedAccounts]);

  function toggleExpand(vendor: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(vendor) ? next.delete(vendor) : next.add(vendor);
      return next;
    });
  }

  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 2, currentYear - 1, currentYear];

  const visibleVendors = result
    ? result.vendors.filter((v) => {
        if (filter === "missing") return v.status === "absent" && v.expectedThisMonth;
        if (filter === "found")   return v.status === "found";
        return true;
      })
    : [];

  const glMissingCount = result
    ? result.journalPatterns.filter((p) => p.status === "absent" && p.expectedThisMonth).length
    : 0;

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Month</label>
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
          <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Year</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">History</label>
          <select
            value={lookback}
            onChange={(e) => setLookback(Number(e.target.value))}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value={3}>3 months</option>
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
            <option value={18}>18 months</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Scope</label>
          <AccountsDropdown selected={selectedAccounts} onChange={setSelectedAccounts} />
        </div>

        <button
          onClick={run}
          disabled={loading}
          className="h-9 self-end rounded-md bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Analysing…" : "Run Check"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {result && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="AP vendors tracked"    value={result.totalTracked}           tone="neutral" />
            <MetricCard label="AP found this month"   value={result.found}                  tone={result.found > 0 ? "ok" : "neutral"} />
            <MetricCard label="AP missing (expected)" value={result.absentExpected}         tone={result.absentExpected > 0 ? "warn" : "ok"} />
            <MetricCard label="GL patterns"           value={result.journalPatterns.length} tone={glMissingCount > 0 ? "warn" : "neutral"} />
          </div>

          {/* Missing banner — AP */}
          {result.absentExpected > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <svg className="mt-0.5 size-5 shrink-0 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
              </svg>
              <div>
                <p className="text-sm font-semibold text-red-800">
                  {result.absentExpected} expected AP {result.absentExpected === 1 ? "vendor" : "vendors"} missing from {result.periodLabel}
                </p>
                <p className="mt-0.5 text-xs text-red-700">
                  These appeared in the prior {result.lookbackMonths} months but have no invoice in this period yet.
                </p>
              </div>
            </div>
          )}

          {/* Missing banner — GL */}
          {glMissingCount > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <svg className="mt-0.5 size-5 shrink-0 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
              </svg>
              <div>
                <p className="text-sm font-semibold text-red-800">
                  {glMissingCount} expected GL {glMissingCount === 1 ? "pattern" : "patterns"} missing from {result.periodLabel}
                </p>
                <p className="mt-0.5 text-xs text-red-700">
                  Recurring journal entries (payroll, rent, accruals) not yet posted this period.
                </p>
              </div>
            </div>
          )}

          {result.absentExpected === 0 && glMissingCount === 0 && result.found > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <svg className="size-5 shrink-0 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd"/>
              </svg>
              <p className="text-sm font-medium text-emerald-800">
                All expected recurring items found for {result.periodLabel}
              </p>
            </div>
          )}

          {/* ── AP Vendors ──────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-700">AP Vendor Invoices</h3>
              <SourceBadge source="ap" />
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {result.totalTracked} vendor{result.totalTracked !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Show:</span>
              {(["all", "missing", "found"] as FilterMode[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filter === f ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {f === "all" ? "All" : f === "missing" ? "Missing" : "Found"}
                </button>
              ))}
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left">
                    <th className="w-4 px-3 py-3" />
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Vendor</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Frequency</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center" title="Last 6 months of lookback">Hist.</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Typical day</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Avg / mo</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleVendors.map((v) => {
                    const isOpen     = expanded.has(v.vendor);
                    const hasData    = v.currentMonthInvoices.length > 0 || v.recentMonths.length > 0;
                    return (
                      <React.Fragment key={v.vendor}>
                        <tr
                          onClick={() => hasData && toggleExpand(v.vendor)}
                          className={`transition-colors ${vendorRowBg(v, isOpen)} ${hasData ? "cursor-pointer" : ""}`}
                        >
                          <td className="px-3 py-3 text-xs text-slate-400">
                            {hasData ? (isOpen ? "▾" : "▸") : null}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`font-medium ${v.status === "absent" && v.expectedThisMonth ? "text-red-800" : "text-slate-800"}`}>
                              {v.vendor}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center"><FreqBadge freq={v.frequency} /></td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex justify-center">
                              <MonthDots seenIn={v.seenInMonths} lookbackEndYM={result.lookbackEndYM} />
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center tabular-nums text-xs text-slate-500">{dayLabel(v.typicalDay)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-xs text-slate-600">{fmtAmount(v.avgMonthlyAmount)}</td>
                          <td className="px-4 py-3 text-center">
                            <StatusChip status={v.status} expectedThisMonth={v.expectedThisMonth} />
                          </td>
                        </tr>
                        {isOpen && hasData && (
                          <tr className={v.status === "found" ? "bg-emerald-50/50" : "bg-slate-50/80"}>
                            <td colSpan={7} className="px-8 pb-4 pt-2">
                              <div className="space-y-3">
                                {/* Current month */}
                                {v.currentMonthInvoices.length > 0 && (
                                  <div>
                                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-700">
                                      {result.periodLabel}
                                    </p>
                                    <div className="overflow-hidden rounded-md border border-emerald-100 bg-white">
                                      <InvoiceTable invoices={v.currentMonthInvoices} />
                                    </div>
                                  </div>
                                )}
                                {/* Prior 3 months */}
                                {v.recentMonths.map((rm) => (
                                  <div key={rm.month}>
                                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                                      {fmtYM(rm.month)}
                                    </p>
                                    <div className="overflow-hidden rounded-md border border-slate-100 bg-white">
                                      <InvoiceTable invoices={rm.invoices} />
                                    </div>
                                  </div>
                                ))}
                                {v.currentMonthInvoices.length === 0 && v.recentMonths.length === 0 && (
                                  <p className="text-xs text-slate-400">No invoice data in this window.</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              {visibleVendors.length === 0 && (
                <div className="py-12 text-center text-sm text-slate-400">No results match the current filter.</div>
              )}
            </div>
          </div>

          {/* ── Possibly new AP vendors ─────────────────────────────────────── */}
          <PossiblyNewSection vendors={result.possiblyNew} periodLabel={result.periodLabel} />

          {/* ── GL Journal Patterns ─────────────────────────────────────────── */}
          {result.journalPatterns.length > 0 && (
            <GlPatternsSection patterns={result.journalPatterns} lookbackEndYM={result.lookbackEndYM} />
          )}

          {/* ── Possibly new GL entries ─────────────────────────────────────── */}
          {result.possiblyNewGl.length > 0 && (
            <PossiblyNewGlSection patterns={result.possiblyNewGl} periodLabel={result.periodLabel} />
          )}

          {result.journalPatterns.length === 0 && result.possiblyNewGl.length === 0 && selectedAccounts.size === 0 && (
            <div className="rounded-lg border border-dashed border-violet-200 bg-violet-50/40 px-4 py-3 text-xs text-violet-600">
              Select GL accounts above to also detect recurring journal entries (payroll, rent accruals, etc.).
            </div>
          )}

          <p className="text-xs text-slate-400">
            Patterns from {result.lookbackMonths} months of BC data ending{" "}
            {new Date(result.lookbackEndYM + "-01").toLocaleString("en-US", { month: "long", year: "numeric" })}.
            Frequency classified by appearances in the last 6 of those months.
            AP path covers purchase invoices; GL path covers journal entries on selected accounts.
          </p>
        </>
      )}

      {!result && !loading && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 py-16 text-center">
          <svg className="mb-3 size-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
          </svg>
          <p className="text-sm font-medium text-slate-500">Select a month and run the check</p>
          <p className="mt-1 text-xs text-slate-400">
            Detects recurring AP vendors and GL journal patterns, then verifies they appear in the selected period
          </p>
        </div>
      )}
    </div>
  );
}
