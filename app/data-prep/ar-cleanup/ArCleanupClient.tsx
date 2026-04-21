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

type MatchedRow = {
  cw: CwRow;
  bc: BcRow;
};

type CloseResult = { id: number; ok: boolean; error?: string };

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const fmtDate = (s: string) => {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
};

/** Normalise a company/customer name for fuzzy matching */
function normName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type CustomerGroup = {
  companyName: string;
  cwInvoices: CwRow[]; // CW open, not in BC
  bcEntries: BcRow[];  // all BC entries for this customer
  totalCwBalance: number;
};

function SummaryCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: "amber" | "red" | "green" | "slate";
}) {
  const colors = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  };
  return (
    <div className={`rounded border px-4 py-3 ${colors[color ?? "slate"]}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs opacity-60">{sub}</div>}
    </div>
  );
}

/** Expandable customer row for the Action Required section */
function CustomerActionRow({
  group,
  selected,
  onToggle,
  onToggleAll,
  closeResults,
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
      {/* Customer summary row */}
      <tr
        className="cursor-pointer hover:bg-amber-50 bg-amber-25 border-t border-slate-200"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-3 py-2.5 w-8" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected && !allSelected;
            }}
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

      {/* Expanded detail */}
      {expanded && (
        <tr>
          <td colSpan={5} className="px-0 py-0 bg-slate-50 border-b border-slate-200">
            <div className="grid grid-cols-2 gap-0 divide-x divide-slate-200">
              {/* CW side */}
              <div className="p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  ConnectWise — Open Invoices (not in BC)
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="pb-1 w-6" />
                      <th className="pb-1">Invoice #</th>
                      <th className="pb-1">Date</th>
                      <th className="pb-1">Due</th>
                      <th className="pb-1">Status</th>
                      <th className="pb-1 text-right">Balance</th>
                      <th className="pb-1 text-center">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {group.cwInvoices.map((inv) => {
                      const res = closeResults.get(inv.id);
                      return (
                        <tr
                          key={inv.id}
                          className={selected.has(inv.id) ? "bg-amber-50" : "hover:bg-white"}
                        >
                          <td
                            className="py-1 pr-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggle(inv.id);
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(inv.id)}
                              onChange={() => onToggle(inv.id)}
                              className="rounded"
                            />
                          </td>
                          <td className="py-1 font-mono">{inv.invoiceNumber}</td>
                          <td className="py-1 text-slate-500">{fmtDate(inv.date)}</td>
                          <td className="py-1 text-slate-500">{fmtDate(inv.dueDate)}</td>
                          <td className="py-1 text-slate-400">{inv.statusName}</td>
                          <td className="py-1 text-right font-mono font-semibold text-amber-700">
                            {fmt(inv.balance)}
                          </td>
                          <td className="py-1 text-center">
                            {res ? (
                              res.ok ? (
                                <span className="text-emerald-600 font-medium">✓</span>
                              ) : (
                                <span className="text-red-500" title={res.error}>✗</span>
                              )
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* BC side */}
              <div className="p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Business Central — All Open Ledger Entries
                </div>
                {group.bcEntries.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">
                    No open BC entries found for this customer.
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                        <th className="pb-1">Type</th>
                        <th className="pb-1">Doc #</th>
                        <th className="pb-1">Ext Doc #</th>
                        <th className="pb-1">Date</th>
                        <th className="pb-1">Due</th>
                        <th className="pb-1 text-right">Remaining</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {group.bcEntries.map((e) => (
                        <tr key={e.id} className="hover:bg-white">
                          <td className="py-1">
                            <span
                              className={`inline-block rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                                e.documentType === "Credit Memo"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {e.documentType === "Credit Memo" ? "CM" : "Inv"}
                            </span>
                          </td>
                          <td className="py-1 font-mono">{e.documentNumber}</td>
                          <td className="py-1 font-mono text-slate-400">
                            {e.externalDocumentNumber || "—"}
                          </td>
                          <td className="py-1 text-slate-500">{fmtDate(e.postingDate)}</td>
                          <td className="py-1 text-slate-500">{fmtDate(e.dueDate)}</td>
                          <td className="py-1 text-right font-mono font-semibold text-slate-700">
                            {fmt(e.remainingAmount)}
                          </td>
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
  const [activeSection, setActiveSection] = useState<"action" | "bc-only" | "matched">("action");
  const [search, setSearch] = useState("");

  // Build BC lookup: externalDocumentNumber → BcRow
  const bcByExtDocNum = useMemo(() => {
    const m = new Map<string, BcRow>();
    for (const bc of bcRows) {
      if (bc.externalDocumentNumber) {
        m.set(bc.externalDocumentNumber.toUpperCase(), bc);
      }
    }
    return m;
  }, [bcRows]);

  // BC entries grouped by normalised customer name
  const bcByCustomer = useMemo(() => {
    const m = new Map<string, BcRow[]>();
    for (const bc of bcRows) {
      const key = normName(bc.customerName);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(bc);
    }
    return m;
  }, [bcRows]);

  // CW invoice numbers for reverse lookup
  const cwInvoiceNumbers = useMemo(
    () => new Set(cwRows.map((r) => r.invoiceNumber.toUpperCase())),
    [cwRows]
  );

  // Categorise CW invoices
  const { actionGroups, matchedRows } = useMemo(() => {
    const actionInvoices: CwRow[] = [];
    const matchedRows: MatchedRow[] = [];

    for (const cw of cwRows) {
      const bc = bcByExtDocNum.get(cw.invoiceNumber.toUpperCase());
      if (bc) matchedRows.push({ cw, bc });
      else actionInvoices.push(cw);
    }

    // Group action invoices by company, attach BC entries for that customer
    const groupMap = new Map<string, CwRow[]>();
    for (const inv of actionInvoices) {
      if (!groupMap.has(inv.companyName)) groupMap.set(inv.companyName, []);
      groupMap.get(inv.companyName)!.push(inv);
    }

    const actionGroups: CustomerGroup[] = Array.from(groupMap.entries())
      .map(([companyName, cwInvoices]) => {
        cwInvoices.sort((a, b) => b.balance - a.balance);
        const bcEntries = bcByCustomer.get(normName(companyName)) ?? [];
        return {
          companyName,
          cwInvoices,
          bcEntries,
          totalCwBalance: cwInvoices.reduce((s, r) => s + r.balance, 0),
        };
      })
      .sort((a, b) => b.totalCwBalance - a.totalCwBalance);

    return { actionGroups, matchedRows };
  }, [cwRows, bcByExtDocNum, bcByCustomer]);

  // BC-only entries
  const bcOnlyRows = useMemo(
    () =>
      bcRows
        .filter(
          (bc) =>
            !bc.externalDocumentNumber ||
            !cwInvoiceNumbers.has(bc.externalDocumentNumber.toUpperCase())
        )
        .sort((a, b) => Math.abs(b.remainingAmount) - Math.abs(a.remainingAmount)),
    [bcRows, cwInvoiceNumbers]
  );

  // Filtered action groups
  const filteredActionGroups = useMemo(() => {
    if (!search) return actionGroups;
    const q = search.toLowerCase();
    return actionGroups
      .map((g) => ({
        ...g,
        cwInvoices: g.cwInvoices.filter(
          (inv) =>
            inv.invoiceNumber.toLowerCase().includes(q) ||
            inv.companyName.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.cwInvoices.length > 0);
  }, [actionGroups, search]);

  const closeResultsMap = useMemo(() => {
    const m = new Map<number, CloseResult>();
    for (const r of closeResultsList) m.set(r.id, r);
    return m;
  }, [closeResultsList]);

  const totalActionBalance = actionGroups.reduce((s, g) => s + g.totalCwBalance, 0);
  const totalMatchedBalance = matchedRows.reduce((s, r) => s + r.cw.balance, 0);
  const totalBcOnly = bcOnlyRows.reduce((s, r) => s + r.remainingAmount, 0);

  const allActionIds = actionGroups.flatMap((g) => g.cwInvoices.map((r) => r.id));
  const selectedBalance = allActionIds
    .filter((id) => selected.has(id))
    .reduce((s, id) => {
      const inv = actionGroups.flatMap((g) => g.cwInvoices).find((r) => r.id === id);
      return s + (inv?.balance ?? 0);
    }, 0);

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
      const failedIds = new Set(
        (json.results ?? []).filter((r) => !r.ok).map((r) => r.id)
      );
      setSelected(failedIds);
      router.refresh();
    } catch (e) {
      setCloseResultsList([{ id: -1, ok: false, error: (e as Error).message }]);
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="CW Open / BC Paid"
          value={actionGroups.reduce((s, g) => s + g.cwInvoices.length, 0)}
          sub={fmt(totalActionBalance)}
          color="amber"
        />
        <SummaryCard
          label="Both Open (matched)"
          value={matchedRows.length}
          sub={fmt(totalMatchedBalance)}
          color="green"
        />
        <SummaryCard
          label="BC Only (no CW invoice)"
          value={bcOnlyRows.length}
          sub={fmt(totalBcOnly)}
          color="slate"
        />
        <SummaryCard
          label="Total CW Open"
          value={cwRows.length}
          sub={`${bcRows.length} BC open entries`}
          color="slate"
        />
      </div>

      {/* Close results banner */}
      {closeResultsList.length > 0 && (
        <div
          className={`rounded border px-4 py-3 text-sm ${
            closeResultsList.every((r) => r.ok)
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {closeResultsList.every((r) => r.ok) ? (
            <span>✓ Closed {closeResultsList.length} invoice{closeResultsList.length !== 1 ? "s" : ""} in ConnectWise.</span>
          ) : (
            <div>
              <div className="font-medium mb-1">Some invoices failed to close:</div>
              <ul className="list-disc list-inside space-y-0.5">
                {closeResultsList
                  .filter((r) => !r.ok)
                  .map((r) => (
                    <li key={r.id}>
                      Invoice ID {r.id}: {r.error}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Tab nav */}
      <nav className="flex gap-1 border-b border-slate-200">
        {(
          [
            {
              key: "action",
              label: `Action Required (${actionGroups.reduce((s, g) => s + g.cwInvoices.length, 0)})`,
            },
            { key: "bc-only", label: `BC Only (${bcOnlyRows.length})` },
            { key: "matched", label: `Both Open (${matchedRows.length})` },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveSection(key)}
            className={`relative rounded-t border-t border-x px-4 py-2 text-sm transition-colors ${
              activeSection === key
                ? "border-slate-300 bg-white text-slate-900 font-medium -mb-px"
                : "border-transparent text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ── ACTION REQUIRED ── */}
      {activeSection === "action" && (
        <div className="space-y-3">
          <div className="text-sm text-slate-600">
            These invoices have a positive balance in CW but no matching open entry in BC.
            Expand each customer to see CW invoices alongside BC ledger entries. Select and
            close in CW once confirmed paid.
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white px-4 py-3">
            <label className="text-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
                Search
              </div>
              <input
                type="text"
                placeholder="Invoice # or company…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-sm w-52"
              />
            </label>
            <div className="ml-auto flex items-center gap-3">
              {selected.size > 0 && (
                <span className="text-sm text-slate-600">
                  {selected.size} selected · {fmt(selectedBalance)}
                </span>
              )}
              <button
                onClick={closeSelected}
                disabled={selected.size === 0 || closing}
                className="rounded bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {closing ? "Closing…" : `Close ${selected.size > 0 ? selected.size : ""} in CW`}
              </button>
            </div>
          </div>

          {filteredActionGroups.length === 0 ? (
            <div className="rounded border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">
              {actionGroups.length === 0
                ? "✓ No discrepancies — CW and BC are in sync."
                : "No results match the current search."}
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
                  {filteredActionGroups.map((group) => (
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
                      Total ({filteredActionGroups.reduce((s, g) => s + g.cwInvoices.length, 0)} invoices ·{" "}
                      {filteredActionGroups.length} customers)
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-amber-700">
                      {fmt(filteredActionGroups.reduce((s, g) => s + g.totalCwBalance, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── BC ONLY ── */}
      {activeSection === "bc-only" && (
        <div className="space-y-3">
          <div className="text-sm text-slate-600">
            BC has open entries with no matching CW invoice number. These may be manual BC
            entries, credit memos, or invoices billed outside ConnectWise.
          </div>
          {bcOnlyRows.length === 0 ? (
            <div className="rounded border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">
              No BC-only entries found.
            </div>
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
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Remaining</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bcOnlyRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                            row.documentType === "Credit Memo"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {row.documentType}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{row.documentNumber}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        {row.externalDocumentNumber || "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{row.customerName}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        {fmtDate(row.postingDate)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        {fmtDate(row.dueDate)}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500 max-w-xs truncate">
                        {row.description || "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-slate-700">
                        {fmt(row.remainingAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <td colSpan={7} className="px-3 py-2 text-right">
                      Total ({bcOnlyRows.length} entries)
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmt(totalBcOnly)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── BOTH OPEN ── */}
      {activeSection === "matched" && (
        <div className="space-y-3">
          <div className="text-sm text-slate-600">
            Both systems agree these are open. Variance column shows CW balance vs. BC remaining
            amount — flag if material.
          </div>
          {matchedRows.length === 0 ? (
            <div className="rounded border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">
              No matched open invoices.
            </div>
          ) : (
            <div className="rounded border border-slate-200 bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Invoice #</th>
                    <th className="px-3 py-2">Company / Customer</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Due Date</th>
                    <th className="px-3 py-2 text-right">CW Balance</th>
                    <th className="px-3 py-2 text-right">BC Remaining</th>
                    <th className="px-3 py-2 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {matchedRows.map(({ cw, bc }) => {
                    const variance = cw.balance - bc.remainingAmount;
                    const hasVariance = Math.abs(variance) > 0.02;
                    return (
                      <tr key={cw.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-xs">{cw.invoiceNumber}</td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{cw.companyName}</div>
                          {normName(bc.customerName) !== normName(cw.companyName) && (
                            <div className="text-[11px] text-slate-400">{bc.customerName}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">
                          {fmtDate(cw.date)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">
                          {fmtDate(cw.dueDate)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          {fmt(cw.balance)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          {fmt(bc.remainingAmount)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-mono text-xs font-semibold ${
                            hasVariance ? "text-red-600" : "text-slate-400"
                          }`}
                        >
                          {hasVariance ? fmt(variance) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <td colSpan={4} className="px-3 py-2 text-right">
                      Total ({matchedRows.length} invoices)
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmt(totalMatchedBalance)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmt(matchedRows.reduce((s, r) => s + r.bc.remainingAmount, 0))}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-red-600">
                      {fmt(
                        matchedRows.reduce(
                          (s, r) => s + (r.cw.balance - r.bc.remainingAmount),
                          0
                        )
                      )}
                    </td>
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
