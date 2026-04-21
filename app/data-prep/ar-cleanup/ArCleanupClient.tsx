"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

export type CwRow = {
  id: number;
  invoiceNumber: string;
  date: string;
  dueDate: string;
  companyName: string;
  total: number;
  balance: number;
  statusName: string;
};

export type BcRow = {
  id: string;
  documentType: string;
  documentNumber: string;
  externalDocumentNumber: string;
  postingDate: string;
  dueDate: string;
  customerName: string;
  description: string;
  remainingAmount: number;
};

type RecStatus = "match" | "amount-differs" | "bc-only" | "cw-only";

type RecRow = {
  invoiceNumber: string;
  customerName: string;
  bcDocType: string;
  cwDocType: string;
  bcAmount: number;
  cwAmount: number;
  cwId: number | null;
  difference: number; // BC − CW
  status: RecStatus;
  dueDate: string; // effective due date for aging
  agingBucket: AgingBucket;
};

type AgingBucket = "Current" | "1-30" | "31-60" | "61-90" | ">90";
const AGING_BUCKETS: AgingBucket[] = ["Current", "1-30", "31-60", "61-90", ">90"];

type CustomerSummaryRow = {
  customerName: string;
  bcTotal: number;
  cwTotal: number;
  difference: number;
  status: "match" | "amount-differs";
  aging: Record<AgingBucket, number>; // CW balance by bucket
};

type CloseResult = { id: number; ok: boolean; error?: string };

type CustomerGroup = {
  companyName: string;
  cwInvoices: CwRow[];
  bcEntries: BcRow[];
  totalCwBalance: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TODAY = new Date().toISOString().slice(0, 10);

function getAgingBucket(dueDate: string): AgingBucket {
  if (!dueDate) return ">90";
  const daysPast = Math.floor(
    (new Date(TODAY).getTime() - new Date(dueDate).getTime()) / 86_400_000
  );
  if (daysPast <= 0) return "Current";
  if (daysPast <= 30) return "1-30";
  if (daysPast <= 60) return "31-60";
  if (daysPast <= 90) return "61-90";
  return ">90";
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const fmtDiff = (n: number) => {
  if (Math.abs(n) < 0.02) return "—";
  return fmt(n);
};

const fmtDate = (s: string) => {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

function normName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const STATUS_LABEL: Record<RecStatus, string> = {
  match: "Match",
  "amount-differs": "Amount differs",
  "bc-only": "BC only",
  "cw-only": "CW only",
};

const STATUS_STYLE: Record<RecStatus, string> = {
  match: "bg-emerald-100 text-emerald-700",
  "amount-differs": "bg-amber-100 text-amber-800",
  "bc-only": "bg-blue-100 text-blue-700",
  "cw-only": "bg-red-100 text-red-700",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label, value, sub, color,
}: {
  label: string; value: string | number; sub?: string;
  color?: "amber" | "red" | "green" | "slate" | "blue";
}) {
  const colors = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
  };
  return (
    <div className={`rounded border px-4 py-3 ${colors[color ?? "slate"]}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs opacity-60">{sub}</div>}
    </div>
  );
}

/** Expandable customer row for the Close Stale tab */
function CustomerActionRow({
  group, selected, onToggle, onToggleAll, closeResults,
}: {
  group: CustomerGroup;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: (ids: number[], on: boolean) => void;
  closeResults: Map<number, CloseResult>;
}) {
  const [expanded, setExpanded] = useState(false);
  const allSelected = group.cwInvoices.every((r) => selected.has(r.id));
  const someSelected = group.cwInvoices.some((r) => selected.has(r.id));
  const ids = group.cwInvoices.map((r) => r.id);

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-amber-50 border-t border-slate-200"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-3 py-2.5 w-8" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={() => onToggleAll(ids, !allSelected)}
            className="rounded"
          />
        </td>
        <td className="px-3 py-2.5 font-medium text-slate-800">
          <span className="mr-1.5 text-slate-400">{expanded ? "▾" : "▸"}</span>
          {group.companyName}
        </td>
        <td className="px-3 py-2.5 text-xs text-slate-500 text-center">
          {group.cwInvoices.length} invoice{group.cwInvoices.length !== 1 ? "s" : ""}
        </td>
        <td className="px-3 py-2.5 text-xs text-slate-500 text-center">
          {group.bcEntries.length} BC entr{group.bcEntries.length !== 1 ? "ies" : "y"}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-sm font-semibold text-amber-700">
          {fmt(group.totalCwBalance)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="px-0 py-0 bg-slate-50 border-b border-slate-200">
            <div className="grid grid-cols-2 gap-0 divide-x divide-slate-200">
              <div className="p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  ConnectWise — Open (not in BC)
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="pb-1 w-6" /><th className="pb-1">Invoice #</th>
                      <th className="pb-1">Date</th><th className="pb-1">Due</th>
                      <th className="pb-1">Aging</th><th className="pb-1 text-right">Balance</th>
                      <th className="pb-1 text-center">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {group.cwInvoices.map((inv) => {
                      const res = closeResults.get(inv.id);
                      return (
                        <tr key={inv.id} className={selected.has(inv.id) ? "bg-amber-50" : "hover:bg-white"}>
                          <td className="py-1 pr-2" onClick={(e) => { e.stopPropagation(); onToggle(inv.id); }}>
                            <input type="checkbox" checked={selected.has(inv.id)} onChange={() => onToggle(inv.id)} className="rounded" />
                          </td>
                          <td className="py-1 font-mono">{inv.invoiceNumber}</td>
                          <td className="py-1 text-slate-500">{fmtDate(inv.date)}</td>
                          <td className="py-1 text-slate-500">{fmtDate(inv.dueDate)}</td>
                          <td className="py-1">
                            <span className="inline-block rounded px-1 py-0.5 text-[9px] font-medium bg-slate-100 text-slate-600">
                              {getAgingBucket(inv.dueDate)}
                            </span>
                          </td>
                          <td className="py-1 text-right font-mono font-semibold text-amber-700">{fmt(inv.balance)}</td>
                          <td className="py-1 text-center">
                            {res ? (res.ok ? <span className="text-emerald-600 font-medium">✓</span> : <span className="text-red-500" title={res.error}>✗</span>) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Business Central — All Open Ledger Entries
                </div>
                {group.bcEntries.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No open BC entries for this customer.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                        <th className="pb-1">Type</th><th className="pb-1">Doc #</th>
                        <th className="pb-1">Ext Doc #</th><th className="pb-1">Date</th>
                        <th className="pb-1">Due</th><th className="pb-1 text-right">Remaining</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {group.bcEntries.map((e) => (
                        <tr key={e.id} className="hover:bg-white">
                          <td className="py-1">
                            <span className={`inline-block rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide ${e.documentType === "Credit Memo" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>
                              {e.documentType === "Credit Memo" ? "CM" : "Inv"}
                            </span>
                          </td>
                          <td className="py-1 font-mono">{e.documentNumber}</td>
                          <td className="py-1 font-mono text-slate-400">{e.externalDocumentNumber || "—"}</td>
                          <td className="py-1 text-slate-500">{fmtDate(e.postingDate)}</td>
                          <td className="py-1 text-slate-500">{fmtDate(e.dueDate)}</td>
                          <td className="py-1 text-right font-mono font-semibold text-slate-700">{fmt(e.remainingAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ArCleanupClient({
  cwRows,
  bcRows,
}: {
  cwRows: CwRow[];
  bcRows: BcRow[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [closing, setClosing] = useState(false);
  const [closeResultsList, setCloseResultsList] = useState<CloseResult[]>([]);
  const [activeTab, setActiveTab] = useState<"rec" | "customer" | "stale" | "bc-only">("rec");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RecStatus | "all">("all");
  const [diagOpen, setDiagOpen] = useState(false);

  // Cutoff date for bulk-close on stale tab
  const oldestBcDate = useMemo(() => {
    const dates = bcRows.filter((r) => r.postingDate).map((r) => r.postingDate).sort();
    return dates[0] ?? "";
  }, [bcRows]);
  const [cutoffDate, setCutoffDate] = useState("");

  // BC lookup by both externalDocumentNumber and documentNumber
  const bcByKey = useMemo(() => {
    const m = new Map<string, BcRow>();
    for (const bc of bcRows) {
      if (bc.externalDocumentNumber) m.set(bc.externalDocumentNumber.toUpperCase(), bc);
      if (bc.documentNumber) {
        const k = bc.documentNumber.toUpperCase();
        if (!m.has(k)) m.set(k, bc);
      }
    }
    return m;
  }, [bcRows]);

  const bcByCustomer = useMemo(() => {
    const m = new Map<string, BcRow[]>();
    for (const bc of bcRows) {
      const k = normName(bc.customerName);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(bc);
    }
    return m;
  }, [bcRows]);

  const cwInvoiceNumbers = useMemo(
    () => new Set(cwRows.map((r) => r.invoiceNumber.toUpperCase())),
    [cwRows]
  );

  // ---------------------------------------------------------------------------
  // Build reconciliation rows
  // ---------------------------------------------------------------------------
  const { recRows, staleGroups, bcOnlyRows } = useMemo(() => {
    const recRows: RecRow[] = [];
    const staleInvoices: CwRow[] = [];
    const matchedBcIds = new Set<string>();

    for (const cw of cwRows) {
      const bc = bcByKey.get(cw.invoiceNumber.toUpperCase());
      if (bc) {
        matchedBcIds.add(bc.id);
        const diff = bc.remainingAmount - cw.balance;
        const status: RecStatus = Math.abs(diff) < 0.02 ? "match" : "amount-differs";
        const dueDate = bc.dueDate || cw.dueDate;
        recRows.push({
          invoiceNumber: cw.invoiceNumber,
          customerName: bc.customerName || cw.companyName,
          bcDocType: bc.documentType,
          cwDocType: cw.statusName || "Invoice",
          bcAmount: bc.remainingAmount,
          cwAmount: cw.balance,
          cwId: cw.id,
          difference: diff,
          status,
          dueDate,
          agingBucket: getAgingBucket(dueDate),
        });
      } else {
        staleInvoices.push(cw);
        recRows.push({
          invoiceNumber: cw.invoiceNumber,
          customerName: cw.companyName,
          bcDocType: "",
          cwDocType: cw.statusName || "Invoice",
          bcAmount: 0,
          cwAmount: cw.balance,
          cwId: cw.id,
          difference: -cw.balance,
          status: "cw-only",
          dueDate: cw.dueDate,
          agingBucket: getAgingBucket(cw.dueDate),
        });
      }
    }

    // BC-only entries
    const bcOnlyRows: BcRow[] = [];
    for (const bc of bcRows) {
      if (matchedBcIds.has(bc.id)) continue;
      const cwMatch =
        cwInvoiceNumbers.has(bc.externalDocumentNumber.toUpperCase()) ||
        cwInvoiceNumbers.has(bc.documentNumber.toUpperCase());
      if (!cwMatch) {
        bcOnlyRows.push(bc);
        recRows.push({
          invoiceNumber: bc.externalDocumentNumber || bc.documentNumber,
          customerName: bc.customerName,
          bcDocType: bc.documentType,
          cwDocType: "",
          bcAmount: bc.remainingAmount,
          cwAmount: 0,
          cwId: null,
          difference: bc.remainingAmount,
          status: "bc-only",
          dueDate: bc.dueDate,
          agingBucket: getAgingBucket(bc.dueDate),
        });
      }
    }

    // Sort: amount-differs → cw-only → bc-only → match; then by abs difference
    const order: Record<RecStatus, number> = { "amount-differs": 0, "cw-only": 1, "bc-only": 2, match: 3 };
    recRows.sort((a, b) => order[a.status] - order[b.status] || Math.abs(b.difference) - Math.abs(a.difference));

    // Stale groups for Close Stale tab
    const groupMap = new Map<string, CwRow[]>();
    for (const inv of staleInvoices) {
      if (!groupMap.has(inv.companyName)) groupMap.set(inv.companyName, []);
      groupMap.get(inv.companyName)!.push(inv);
    }
    const staleGroups: CustomerGroup[] = Array.from(groupMap.entries())
      .map(([companyName, cwInvoices]) => {
        cwInvoices.sort((a, b) => b.balance - a.balance);
        return {
          companyName,
          cwInvoices,
          bcEntries: bcByCustomer.get(normName(companyName)) ?? [],
          totalCwBalance: cwInvoices.reduce((s, r) => s + r.balance, 0),
        };
      })
      .sort((a, b) => b.totalCwBalance - a.totalCwBalance);

    return { recRows, staleGroups, bcOnlyRows };
  }, [cwRows, bcRows, bcByKey, bcByCustomer, cwInvoiceNumbers]);

  // Customer summary
  const customerSummaryRows = useMemo((): CustomerSummaryRow[] => {
    const map = new Map<string, CustomerSummaryRow>();
    for (const row of recRows) {
      const key = normName(row.customerName);
      if (!map.has(key)) {
        map.set(key, {
          customerName: row.customerName,
          bcTotal: 0,
          cwTotal: 0,
          difference: 0,
          status: "match",
          aging: { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, ">90": 0 },
        });
      }
      const c = map.get(key)!;
      c.bcTotal += row.bcAmount;
      c.cwTotal += row.cwAmount;
      c.aging[row.agingBucket] += row.cwAmount > 0 ? row.cwAmount : row.bcAmount;
      if (row.status !== "match") c.status = "amount-differs";
    }
    const rows = Array.from(map.values()).map((c) => ({
      ...c,
      difference: c.bcTotal - c.cwTotal,
    }));
    rows.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
    return rows;
  }, [recRows]);

  // Filtered rec rows
  const filteredRecRows = useMemo(() => {
    let rows = recRows;
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.invoiceNumber.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [recRows, statusFilter, search]);

  // Summary totals
  const bcTotal = bcRows.reduce((s, r) => s + r.remainingAmount, 0);
  const cwTotal = cwRows.reduce((s, r) => s + (r.balance ?? 0), 0);
  const statusCounts = useMemo(() => {
    const c: Record<RecStatus, number> = { match: 0, "amount-differs": 0, "bc-only": 0, "cw-only": 0 };
    for (const r of recRows) c[r.status]++;
    return c;
  }, [recRows]);

  const closeResultsMap = useMemo(() => {
    const m = new Map<number, CloseResult>();
    for (const r of closeResultsList) m.set(r.id, r);
    return m;
  }, [closeResultsList]);

  // Selected balance (works across both stale tab and rec tab)
  const selectedBalance = useMemo(() => {
    let total = 0;
    for (const r of recRows) {
      if (r.cwId !== null && selected.has(r.cwId)) total += r.cwAmount;
    }
    return total;
  }, [recRows, selected]);

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleGroup(ids: number[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  async function closeSelected() {
    if (selected.size === 0) return;
    setClosing(true);
    try {
      const res = await fetch("/api/ar-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", invoiceIds: Array.from(selected) }),
      });
      const json = (await res.json()) as { ok: boolean; results: CloseResult[] };
      setCloseResultsList(json.results ?? []);
      const failedIds = new Set((json.results ?? []).filter((r) => !r.ok).map((r) => r.id));
      setSelected(failedIds);
      router.refresh();
    } catch (e) {
      setCloseResultsList([{ id: -1, ok: false, error: (e as Error).message }]);
    } finally {
      setClosing(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-5">

      {/* Diagnostics */}
      <div className="rounded border border-slate-200 bg-slate-50">
        <button
          onClick={() => setDiagOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 text-left"
        >
          <span>{diagOpen ? "▾" : "▸"}</span>
          Diagnostics — sample match keys
        </button>
        {diagOpen && (
          <div className="border-t border-slate-200 p-4 grid grid-cols-2 gap-6">
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">CW invoiceNumber (first 10)</div>
              <table className="w-full text-xs font-mono">
                <thead><tr className="text-[10px] text-slate-400 text-left"><th className="pb-1">Invoice #</th><th className="pb-1">Company</th><th className="pb-1 text-right">Balance</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {cwRows.slice(0, 10).map((r) => (
                    <tr key={r.id}><td className="py-0.5">{r.invoiceNumber}</td><td className="py-0.5 text-slate-500 truncate max-w-[120px]">{r.companyName}</td><td className="py-0.5 text-right">{fmt(r.balance)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">BC documentNumber / externalDocumentNumber (first 10)</div>
              <table className="w-full text-xs font-mono">
                <thead><tr className="text-[10px] text-slate-400 text-left"><th className="pb-1">Doc #</th><th className="pb-1">Ext Doc #</th><th className="pb-1">Customer</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {bcRows.slice(0, 10).map((r) => (
                    <tr key={r.id}><td className="py-0.5">{r.documentNumber}</td><td className="py-0.5 text-slate-400">{r.externalDocumentNumber || "—"}</td><td className="py-0.5 text-slate-500 truncate max-w-[120px]">{r.customerName}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="BC Total AR" value={fmt(bcTotal)} sub={`${bcRows.length} entries`} color="blue" />
        <SummaryCard label="CW Total AR" value={fmt(cwTotal)} sub={`${cwRows.length} invoices`} color="slate" />
        <SummaryCard
          label="Difference (BC − CW)"
          value={fmt(bcTotal - cwTotal)}
          sub={Math.abs(bcTotal - cwTotal) < 0.02 ? "In balance" : "Out of balance"}
          color={Math.abs(bcTotal - cwTotal) < 0.02 ? "green" : "amber"}
        />
        <SummaryCard label="Match Rate" value={`${Math.round((statusCounts.match / Math.max(recRows.length, 1)) * 100)}%`} sub={`${statusCounts.match} of ${recRows.length} invoices`} color="green" />
      </div>

      {/* Match status breakdown */}
      <div className="grid grid-cols-4 gap-2">
        {(["match", "amount-differs", "bc-only", "cw-only"] as RecStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
            className={`rounded border px-3 py-2 text-left transition-colors ${statusFilter === s ? "border-slate-400 bg-slate-100" : "border-slate-200 bg-white hover:bg-slate-50"}`}
          >
            <div className="text-xs text-slate-500">{STATUS_LABEL[s]}</div>
            <div className="mt-0.5 text-lg font-semibold text-slate-800">{statusCounts[s]}</div>
          </button>
        ))}
      </div>

      {/* Close results banner */}
      {closeResultsList.length > 0 && (
        <div className={`rounded border px-4 py-3 text-sm ${closeResultsList.every((r) => r.ok) ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          {closeResultsList.every((r) => r.ok) ? (
            <span>✓ Closed {closeResultsList.length} invoice{closeResultsList.length !== 1 ? "s" : ""} in ConnectWise.</span>
          ) : (
            <div>
              <div className="font-medium mb-1">Some invoices failed to close:</div>
              <ul className="list-disc list-inside space-y-0.5">
                {closeResultsList.filter((r) => !r.ok).map((r) => (
                  <li key={r.id}>Invoice ID {r.id}: {r.error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <nav className="flex gap-1 border-b border-slate-200">
        {([
          { key: "rec", label: "Reconciliation" },
          { key: "customer", label: "Customer Summary" },
          { key: "stale", label: `Close Stale CW (${staleGroups.reduce((s, g) => s + g.cwInvoices.length, 0)})` },
          { key: "bc-only", label: `BC Only (${bcOnlyRows.length})` },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`relative rounded-t border-t border-x px-4 py-2 text-sm transition-colors ${activeTab === key ? "border-slate-300 bg-white text-slate-900 font-medium -mb-px" : "border-transparent text-slate-600 hover:bg-slate-50"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ── RECONCILIATION TAB ── */}
      {activeTab === "rec" && (
        <div className="space-y-3">
          {/* Toolbar */}
          <div className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white px-4 py-3">
            <label className="text-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">Search</div>
              <input
                type="text"
                placeholder="Invoice # or customer…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-sm w-52"
              />
            </label>
            {statusFilter !== "all" && (
              <span className={`self-end mb-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[statusFilter]}`}>
                {STATUS_LABEL[statusFilter]}
                <button onClick={() => setStatusFilter("all")} className="ml-1 opacity-60 hover:opacity-100">✕</button>
              </span>
            )}
            <div className="ml-auto flex items-center gap-3">
              {selected.size > 0 && (
                <span className="text-sm text-slate-600">{selected.size} selected · {fmt(selectedBalance)}</span>
              )}
              <button
                onClick={closeSelected}
                disabled={selected.size === 0 || closing}
                className="rounded bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {closing ? "Closing…" : `Close ${selected.size > 0 ? selected.size : ""} in CW`}
              </button>
            </div>
          </div>

          <div className="rounded border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2">Invoice #</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">BC Type</th>
                  <th className="px-3 py-2">CW Type</th>
                  <th className="px-3 py-2 text-right">BC Amount</th>
                  <th className="px-3 py-2 text-right">CW Amount</th>
                  <th className="px-3 py-2 text-right">Diff (BC−CW)</th>
                  <th className="px-3 py-2">Aging</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecRows.map((row, i) => {
                  const canClose = row.status === "cw-only" && row.cwId !== null;
                  const isSelected = canClose && selected.has(row.cwId!);
                  const closeRes = row.cwId ? closeResultsMap.get(row.cwId) : undefined;
                  return (
                    <tr key={i} className={`hover:bg-slate-50 ${isSelected ? "bg-red-50" : ""}`}>
                      <td className="px-3 py-2">
                        {canClose && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(row.cwId!)}
                            className="rounded"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{row.invoiceNumber}</td>
                      <td className="px-3 py-2 text-slate-700 max-w-[200px] truncate">{row.customerName}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{row.bcDocType || "—"}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{row.cwDocType || "—"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{row.bcAmount !== 0 ? fmt(row.bcAmount) : "—"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{row.cwAmount !== 0 ? fmt(row.cwAmount) : "—"}</td>
                      <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${Math.abs(row.difference) > 0.02 ? "text-red-600" : "text-slate-400"}`}>
                        {fmtDiff(row.difference)}
                        {closeRes && (closeRes.ok ? <span className="ml-1 text-emerald-600">✓</span> : <span className="ml-1 text-red-500" title={closeRes.error}>✗</span>)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600">
                          {row.agingBucket}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[row.status]}`}>
                          {STATUS_LABEL[row.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <td colSpan={5} className="px-3 py-2 text-right">Total ({filteredRecRows.length} rows)</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(filteredRecRows.reduce((s, r) => s + r.bcAmount, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(filteredRecRows.reduce((s, r) => s + r.cwAmount, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-600">
                    {fmtDiff(filteredRecRows.reduce((s, r) => s + r.difference, 0))}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── CUSTOMER SUMMARY TAB ── */}
      {activeTab === "customer" && (
        <div className="space-y-3">
          <div className="text-sm text-slate-600">
            Customer-level reconciliation sorted by largest absolute difference. Aging buckets show CW open balance by days past due.
          </div>
          <div className="rounded border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2 text-right">BC Total</th>
                  <th className="px-3 py-2 text-right">CW Total</th>
                  <th className="px-3 py-2 text-right">Diff (BC−CW)</th>
                  {AGING_BUCKETS.map((b) => (
                    <th key={b} className="px-3 py-2 text-right">{b}</th>
                  ))}
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customerSummaryRows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800 max-w-[200px] truncate">{row.customerName}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{fmt(row.bcTotal)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{fmt(row.cwTotal)}</td>
                    <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${Math.abs(row.difference) > 0.02 ? "text-red-600" : "text-slate-400"}`}>
                      {fmtDiff(row.difference)}
                    </td>
                    {AGING_BUCKETS.map((b) => (
                      <td key={b} className="px-3 py-2 text-right font-mono text-xs text-slate-600">
                        {row.aging[b] !== 0 ? fmt(row.aging[b]) : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${row.status === "match" ? STATUS_STYLE.match : STATUS_STYLE["amount-differs"]}`}>
                        {row.status === "match" ? "Match" : "Differs"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <td className="px-3 py-2">Total ({customerSummaryRows.length} customers)</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(customerSummaryRows.reduce((s, r) => s + r.bcTotal, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(customerSummaryRows.reduce((s, r) => s + r.cwTotal, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-600">
                    {fmtDiff(customerSummaryRows.reduce((s, r) => s + r.difference, 0))}
                  </td>
                  {AGING_BUCKETS.map((b) => (
                    <td key={b} className="px-3 py-2 text-right font-mono">
                      {fmt(customerSummaryRows.reduce((s, r) => s + r.aging[b], 0))}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── CLOSE STALE CW TAB ── */}
      {activeTab === "stale" && (
        <div className="space-y-3">
          <div className="text-sm text-slate-600">
            CW invoices with a balance but no matching open BC entry — likely paid in BC. Expand each customer to compare CW invoices against BC ledger entries, then close in CW.
          </div>
          {/* Toolbar */}
          <div className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white px-4 py-3">
            <label className="text-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">Search</div>
              <input
                type="text"
                placeholder="Invoice # or company…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-sm w-52"
              />
            </label>
            <div className="flex items-end gap-2 border-l border-slate-200 pl-3">
              <label className="text-sm">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
                  Close older than
                  {oldestBcDate && (
                    <button
                      onClick={() => setCutoffDate(oldestBcDate)}
                      className="ml-1.5 normal-case text-[10px] text-slate-400 hover:text-slate-600 underline"
                    >
                      (oldest BC: {fmtDate(oldestBcDate)})
                    </button>
                  )}
                </div>
                <input
                  type="date"
                  value={cutoffDate}
                  onChange={(e) => setCutoffDate(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                />
              </label>
              <button
                disabled={!cutoffDate}
                onClick={() => {
                  if (!cutoffDate) return;
                  const ids = staleGroups.flatMap((g) => g.cwInvoices).filter((inv) => inv.date <= cutoffDate).map((inv) => inv.id);
                  setSelected((prev) => { const next = new Set(prev); ids.forEach((id) => next.add(id)); return next; });
                }}
                className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Select
              </button>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {selected.size > 0 && <span className="text-sm text-slate-600">{selected.size} selected · {fmt(selectedBalance)}</span>}
              <button
                onClick={closeSelected}
                disabled={selected.size === 0 || closing}
                className="rounded bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {closing ? "Closing…" : `Close ${selected.size > 0 ? selected.size : ""} in CW`}
              </button>
            </div>
          </div>

          {staleGroups.length === 0 ? (
            <div className="rounded border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">
              ✓ No stale CW invoices — everything in CW has a matching open BC entry.
            </div>
          ) : (
            <div className="rounded border border-slate-200 bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 w-8" />
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2 text-center">CW Open</th>
                    <th className="px-3 py-2 text-center">BC Entries</th>
                    <th className="px-3 py-2 text-right">CW Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {staleGroups
                    .filter((g) => !search || g.companyName.toLowerCase().includes(search.toLowerCase()) || g.cwInvoices.some((inv) => inv.invoiceNumber.toLowerCase().includes(search.toLowerCase())))
                    .map((group) => (
                      <CustomerActionRow
                        key={group.companyName}
                        group={group}
                        selected={selected}
                        onToggle={toggleOne}
                        onToggleAll={toggleGroup}
                        closeResults={closeResultsMap}
                      />
                    ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 text-xs font-semibold text-slate-600">
                    <td colSpan={4} className="px-3 py-2 text-right">
                      Total ({staleGroups.reduce((s, g) => s + g.cwInvoices.length, 0)} invoices · {staleGroups.length} customers)
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-amber-700">
                      {fmt(staleGroups.reduce((s, g) => s + g.totalCwBalance, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── BC ONLY TAB ── */}
      {activeTab === "bc-only" && (
        <div className="space-y-3">
          <div className="text-sm text-slate-600">
            BC has open entries with no matching CW invoice number — manual entries, credit memos, or invoices billed outside ConnectWise.
          </div>
          {bcOnlyRows.length === 0 ? (
            <div className="rounded border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">No BC-only entries.</div>
          ) : (
            <div className="rounded border border-slate-200 bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">BC Doc #</th>
                    <th className="px-3 py-2">Ext Doc #</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Posting Date</th>
                    <th className="px-3 py-2">Due Date</th>
                    <th className="px-3 py-2">Aging</th>
                    <th className="px-3 py-2 text-right">Remaining</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bcOnlyRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${row.documentType === "Credit Memo" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                          {row.documentType}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{row.documentNumber}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.externalDocumentNumber || "—"}</td>
                      <td className="px-3 py-2 text-slate-700">{row.customerName}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{fmtDate(row.postingDate)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{fmtDate(row.dueDate)}</td>
                      <td className="px-3 py-2">
                        <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600">
                          {getAgingBucket(row.dueDate)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-slate-700">{fmt(row.remainingAmount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <td colSpan={7} className="px-3 py-2 text-right">Total ({bcOnlyRows.length} entries)</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(bcOnlyRows.reduce((s, r) => s + r.remainingAmount, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
