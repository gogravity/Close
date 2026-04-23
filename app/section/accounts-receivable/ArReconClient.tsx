"use client";

import { useMemo, useState } from "react";
import { fmt } from "@/lib/recon";

type Customer = {
  customerNumber: string;
  name: string;
  balanceDue: number;
  current: number;
  d1to60: number;
  d61to90: number;
  d91to180: number;
  d181to360: number;
  over360: number;
};

type Totals = {
  balanceDue: number;
  current: number;
  d1to60: number;
  d61to90: number;
  d91to180: number;
  d181to360: number;
  over360: number;
};

type AllowanceRates = {
  current: number;
  d1to60: number;
  d61to90: number;
  d91to180: number;
  d181to360: number;
  over360: number;
};

export type PostableAccount = {
  number: string;
  displayName: string;
};

export type CwOpenInvoice = {
  id: number;
  invoiceNumber: string;
  date: string;
  dueDate: string;
  companyName: string;
  total: number;
  balance: number;
};

export type BcLedgerEntry = {
  id: string;
  documentType: string;
  documentNumber: string;
  externalDocumentNumber: string;
  postingDate: string;
  dueDate: string;
  customerNumber: string;
  customerName: string;
  description: string;
  amount: number;
  remainingAmount: number;
};

type Props = {
  periodEnd: string;
  asOfDate: string;
  totals: Totals;
  customers: Customer[];
  arGlBalance: number;
  allowanceAccount: PostableAccount | null;   // the mapped allowance acct (e.g. 101020)
  allowanceGlBalance: number;
  badDebtAccount: PostableAccount | null;      // auto-detected from BC chart
  initialInput: {
    allowanceRates: AllowanceRates;
    notes?: string;
  };
  hideCustomerDetail?: boolean;
  cwOpenInvoices?: CwOpenInvoice[];
  bcOpenInvoices?: BcLedgerEntry[];
};

function toPct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

export default function ArReconClient({
  periodEnd,
  asOfDate,
  totals,
  customers,
  arGlBalance,
  allowanceAccount,
  allowanceGlBalance,
  badDebtAccount,
  initialInput,
  hideCustomerDetail,
  cwOpenInvoices = [],
  bcOpenInvoices = [],
}: Props) {
  const [compView, setCompView] = useState<"customer" | "transaction">("customer");
  // Allowance rates are set by Lyra corporate policy and are not editable.
  const rates = initialInput.allowanceRates;

  const allowanceByBucket = useMemo(
    () => ({
      current: totals.current * rates.current,
      d1to60: totals.d1to60 * rates.d1to60,
      d61to90: totals.d61to90 * rates.d61to90,
      d91to180: totals.d91to180 * rates.d91to180,
      d181to360: totals.d181to360 * rates.d181to360,
      over360: totals.over360 * rates.over360,
    }),
    [totals, rates]
  );
  const expectedAllowance =
    allowanceByBucket.current +
    allowanceByBucket.d1to60 +
    allowanceByBucket.d61to90 +
    allowanceByBucket.d91to180 +
    allowanceByBucket.d181to360 +
    allowanceByBucket.over360;

  // Allowance is stored as a negative number in GL (contra-asset).
  const currentAllowance = Math.abs(allowanceGlBalance);
  const adjustment = expectedAllowance - currentAllowance;
  const materialAdjustment = Math.abs(adjustment) >= 0.01;

  return (
    <div className="space-y-6">
      {/* 4-panel header strip */}
      <div className="grid grid-cols-4 gap-3">
        <Panel label="AR Balance (GL)" value={fmt(arGlBalance)} tone="neutral" />
        <Panel label="Aging Total (BC)" value={fmt(totals.balanceDue)} tone="neutral" />
        <Panel
          label="Current Allowance"
          value={fmt(allowanceGlBalance)}
          tone="neutral"
        />
        <Panel
          label="Adjustment to Allowance"
          value={fmt(adjustment)}
          tone={materialAdjustment ? "warn" : "ok"}
        />
      </div>

      {/* Aging bucket + allowance matrix */}
      <div className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
          Aging & Allowance — as of {asOfDate}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Bucket</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 text-right font-medium">% of Total AR</th>
              <th className="px-4 py-2 text-right font-medium w-[140px]">Allowance Rate</th>
              <th className="px-4 py-2 text-right font-medium w-[140px]">Allowance</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                { key: "current", label: "Current", amt: totals.current, rate: rates.current, alw: allowanceByBucket.current },
                { key: "d1to60", label: "1 - 60 days", amt: totals.d1to60, rate: rates.d1to60, alw: allowanceByBucket.d1to60 },
                { key: "d61to90", label: "61 - 90 days", amt: totals.d61to90, rate: rates.d61to90, alw: allowanceByBucket.d61to90 },
                { key: "d91to180", label: "91 - 180 days", amt: totals.d91to180, rate: rates.d91to180, alw: allowanceByBucket.d91to180 },
                { key: "d181to360", label: "181 - 360 days", amt: totals.d181to360, rate: rates.d181to360, alw: allowanceByBucket.d181to360 },
                { key: "over360", label: "Over 360 days", amt: totals.over360, rate: rates.over360, alw: allowanceByBucket.over360 },
              ] as const
            ).map((row) => {
              const pct = totals.balanceDue !== 0 ? row.amt / totals.balanceDue : 0;
              return (
                <tr key={row.key} className="border-t border-slate-100">
                  <td className="px-4 py-1.5">{row.label}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{fmt(row.amt)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">
                    {toPct(pct)}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-slate-700"
                      title="Set by Lyra corporate policy — not editable">
                    {toPct(row.rate)}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{fmt(row.alw)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
              <td className="px-4 py-1.5">AR balance</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(totals.balanceDue)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">100.00%</td>
              <td className="px-4 py-1.5"></td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(expectedAllowance)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* JE */}
      {materialAdjustment ? (
        <div className="rounded border border-amber-200 bg-amber-50/40">
          <div className="border-b border-amber-200 px-4 py-2 text-sm font-semibold text-amber-900">
            Adjusting Journal Entry
          </div>
          <div className="px-4 py-3 space-y-2 text-sm">
            <div className="text-xs text-amber-800">
              {adjustment > 0
                ? `Allowance is understated by ${fmt(adjustment)}. Book additional bad debt expense.`
                : `Allowance is overstated by ${fmt(Math.abs(adjustment))}. Reverse excess bad debt expense.`}
            </div>
            <table className="mt-2 w-full text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th className="text-left font-medium py-1 w-[80px]">BC #</th>
                  <th className="text-left font-medium py-1">Account</th>
                  <th className="text-right font-medium py-1 w-[130px]">Debit</th>
                  <th className="text-right font-medium py-1 w-[130px]">Credit</th>
                </tr>
              </thead>
              <tbody className="border-t border-amber-200">
                {adjustment > 0 ? (
                  <>
                    <JeRow
                      account={badDebtAccount}
                      fallbackName="Bad Debt Expense"
                      debit={adjustment}
                      credit={0}
                    />
                    <JeRow
                      account={allowanceAccount}
                      fallbackName="Allowance for Doubtful Accounts"
                      debit={0}
                      credit={adjustment}
                    />
                  </>
                ) : (
                  <>
                    <JeRow
                      account={allowanceAccount}
                      fallbackName="Allowance for Doubtful Accounts"
                      debit={Math.abs(adjustment)}
                      credit={0}
                    />
                    <JeRow
                      account={badDebtAccount}
                      fallbackName="Bad Debt Expense"
                      debit={0}
                      credit={Math.abs(adjustment)}
                    />
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm text-emerald-900">
          ✓ Allowance already ties to aging-based expectation. No adjusting JE required.
        </div>
      )}

      {/* Customer drill-down — hidden when the parent route has its own AR Aging tab */}
      {!hideCustomerDetail && (
      <details className="rounded border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-slate-900">
          Customer aging detail ({customers.length} with balances)
        </summary>
        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-[80px]">Customer</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Current</th>
                <th className="px-3 py-2 text-right font-medium">1-60</th>
                <th className="px-3 py-2 text-right font-medium">61-90</th>
                <th className="px-3 py-2 text-right font-medium">91-180</th>
                <th className="px-3 py-2 text-right font-medium">181-360</th>
                <th className="px-3 py-2 text-right font-medium">&gt;360</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.customerNumber} className="border-t border-slate-100">
                  <td className="px-3 py-1 font-mono text-[11px] text-slate-500">
                    {c.customerNumber}
                  </td>
                  <td className="px-3 py-1 truncate max-w-[260px]">{c.name}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{c.current === 0 ? "" : fmt(c.current)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{c.d1to60 === 0 ? "" : fmt(c.d1to60)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{c.d61to90 === 0 ? "" : fmt(c.d61to90)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{c.d91to180 === 0 ? "" : fmt(c.d91to180)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{c.d181to360 === 0 ? "" : fmt(c.d181to360)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{c.over360 === 0 ? "" : fmt(c.over360)}</td>
                  <td className="px-3 py-1 text-right tabular-nums font-medium">{fmt(c.balanceDue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      )}

      <div className="border-t border-slate-200 pt-4 text-xs text-slate-500">
        Period: {periodEnd}
      </div>

      {/* CW vs BC Comparison */}
      {(cwOpenInvoices.length > 0 || bcOpenInvoices.length > 0) && (
        <CwBcComparison
          cwInvoices={cwOpenInvoices}
          bcEntries={bcOpenInvoices}
          agingCustomers={customers}
          view={compView}
          onViewChange={setCompView}
        />
      )}
    </div>
  );
}

/* ── CW vs BC Comparison ── */

function nameLower(s: string) { return s.trim().toLowerCase(); }

function CwBcComparison({
  cwInvoices,
  bcEntries,
  agingCustomers,
  view,
  onViewChange,
}: {
  cwInvoices: CwOpenInvoice[];
  bcEntries: BcLedgerEntry[];
  agingCustomers: { name: string; balanceDue: number }[];
  view: "customer" | "transaction";
  onViewChange: (v: "customer" | "transaction") => void;
}) {
  // ── By Customer ──────────────────────────────────────────────────────────
  // Group CW open balance by company name
  const cwByCustomer = useMemo(() => {
    const m = new Map<string, number>();
    for (const inv of cwInvoices) {
      const key = nameLower(inv.companyName);
      m.set(key, (m.get(key) ?? 0) + inv.balance);
    }
    return m;
  }, [cwInvoices]);

  // BC aging is already by customer; build a lookup
  const bcAgingByCustomer = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of agingCustomers) {
      m.set(nameLower(c.name), c.balanceDue);
    }
    return m;
  }, [agingCustomers]);

  // Union of all customer names (prefer BC casing)
  const allCustomerNames = useMemo(() => {
    const names = new Map<string, string>(); // lower → display
    for (const c of agingCustomers) names.set(nameLower(c.name), c.name);
    for (const inv of cwInvoices) {
      const k = nameLower(inv.companyName);
      if (!names.has(k)) names.set(k, inv.companyName);
    }
    return Array.from(names.values()).sort((a, b) => a.localeCompare(b));
  }, [agingCustomers, cwInvoices]);

  const customerRows = useMemo(() =>
    allCustomerNames.map((name) => {
      const key = nameLower(name);
      const cw = cwByCustomer.get(key) ?? 0;
      const bc = bcAgingByCustomer.get(key) ?? 0;
      return { name, cw, bc, variance: cw - bc };
    }).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)),
  [allCustomerNames, cwByCustomer, bcAgingByCustomer]);

  const custTotalCw = customerRows.reduce((s, r) => s + r.cw, 0);
  const custTotalBc = customerRows.reduce((s, r) => s + r.bc, 0);

  // ── By Transaction ───────────────────────────────────────────────────────
  // BC keyed by externalDocumentNumber (= CW invoice number)
  const bcByExtDoc = useMemo(() => {
    const m = new Map<string, BcLedgerEntry[]>();
    for (const e of bcEntries) {
      if (!e.externalDocumentNumber) continue;
      const list = m.get(e.externalDocumentNumber) ?? [];
      list.push(e);
      m.set(e.externalDocumentNumber, list);
    }
    return m;
  }, [bcEntries]);

  const txnRows = useMemo(() => {
    const rows: {
      key: string;
      cwInv: CwOpenInvoice | null;
      bcEntry: BcLedgerEntry | null;
      cwBalance: number;
      bcRemaining: number;
      variance: number;
    }[] = [];

    const usedBcKeys = new Set<string>();

    // CW invoices — match to BC by invoice number
    for (const inv of cwInvoices) {
      const matches = bcByExtDoc.get(inv.invoiceNumber) ?? [];
      if (matches.length > 0) {
        for (const bc of matches) {
          usedBcKeys.add(bc.id);
          rows.push({
            key: `${inv.id}-${bc.id}`,
            cwInv: inv,
            bcEntry: bc,
            cwBalance: inv.balance,
            bcRemaining: bc.remainingAmount,
            variance: inv.balance - bc.remainingAmount,
          });
        }
      } else {
        rows.push({
          key: `cw-${inv.id}`,
          cwInv: inv,
          bcEntry: null,
          cwBalance: inv.balance,
          bcRemaining: 0,
          variance: inv.balance,
        });
      }
    }

    // BC entries with no matching CW invoice
    for (const e of bcEntries) {
      if (!usedBcKeys.has(e.id)) {
        rows.push({
          key: `bc-${e.id}`,
          cwInv: null,
          bcEntry: e,
          cwBalance: 0,
          bcRemaining: e.remainingAmount,
          variance: -e.remainingAmount,
        });
      }
    }

    return rows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  }, [cwInvoices, bcEntries, bcByExtDoc]);

  const txnTotalCw = txnRows.reduce((s, r) => s + r.cwBalance, 0);
  const txnTotalBc = txnRows.reduce((s, r) => s + r.bcRemaining, 0);

  return (
    <div className="rounded border border-slate-200 bg-white">
      {/* Header + tab strip */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <span className="text-sm font-semibold text-slate-700">CW vs BC Open AR</span>
        <div className="flex gap-1">
          {(["customer", "transaction"] as const).map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                view === v
                  ? "bg-slate-800 text-white"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {v === "customer" ? "By Customer" : "By Transaction"}
            </button>
          ))}
        </div>
      </div>

      {view === "customer" && (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Customer</th>
              <th className="px-4 py-2 text-right font-medium">CW Open Balance</th>
              <th className="px-4 py-2 text-right font-medium">BC Aging Balance</th>
              <th className="px-4 py-2 text-right font-medium">Variance</th>
            </tr>
          </thead>
          <tbody>
            {customerRows.map((r) => (
              <tr key={r.name} className="border-t border-slate-100">
                <td className="px-4 py-1.5">{r.name}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{r.cw === 0 ? "–" : fmt(r.cw)}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{r.bc === 0 ? "–" : fmt(r.bc)}</td>
                <td className={`px-4 py-1.5 text-right tabular-nums font-medium ${
                  Math.abs(r.variance) < 0.01 ? "text-emerald-600" : "text-amber-700"
                }`}>
                  {Math.abs(r.variance) < 0.01 ? "–" : fmt(r.variance)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <td className="px-4 py-1.5">Total</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(custTotalCw)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(custTotalBc)}</td>
              <td className={`px-4 py-1.5 text-right tabular-nums ${
                Math.abs(custTotalCw - custTotalBc) < 0.01 ? "text-emerald-600" : "text-amber-700"
              }`}>{fmt(custTotalCw - custTotalBc)}</td>
            </tr>
          </tbody>
        </table>
      )}

      {view === "transaction" && (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left font-medium">CW Invoice #</th>
              <th className="px-4 py-2 text-left font-medium">BC Doc #</th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-left font-medium">Customer</th>
              <th className="px-4 py-2 text-right font-medium">Date</th>
              <th className="px-4 py-2 text-right font-medium">CW Balance</th>
              <th className="px-4 py-2 text-right font-medium">BC Remaining</th>
              <th className="px-4 py-2 text-right font-medium">Variance</th>
            </tr>
          </thead>
          <tbody>
            {txnRows.map((r) => (
              <tr key={r.key} className="border-t border-slate-100">
                <td className="px-4 py-1.5 font-mono text-xs text-slate-600">
                  {r.cwInv?.invoiceNumber ?? <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-1.5 font-mono text-xs text-slate-600">
                  {r.bcEntry?.documentNumber ?? <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-1.5 text-slate-500 text-xs">
                  {r.bcEntry?.documentType ?? (r.cwInv ? "CW Invoice" : "—")}
                </td>
                <td className="px-4 py-1.5 max-w-[200px] truncate">
                  {r.cwInv?.companyName ?? r.bcEntry?.customerName ?? "—"}
                </td>
                <td className="px-4 py-1.5 text-right text-xs text-slate-500 tabular-nums">
                  {r.cwInv?.date ?? r.bcEntry?.postingDate ?? ""}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {r.cwBalance === 0 ? "–" : fmt(r.cwBalance)}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {r.bcRemaining === 0 ? "–" : fmt(r.bcRemaining)}
                </td>
                <td className={`px-4 py-1.5 text-right tabular-nums font-medium ${
                  Math.abs(r.variance) < 0.01 ? "text-emerald-600" : "text-amber-700"
                }`}>
                  {Math.abs(r.variance) < 0.01 ? "–" : fmt(r.variance)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <td className="px-4 py-1.5" colSpan={5}>Total</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(txnTotalCw)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(txnTotalBc)}</td>
              <td className={`px-4 py-1.5 text-right tabular-nums ${
                Math.abs(txnTotalCw - txnTotalBc) < 0.01 ? "text-emerald-600" : "text-amber-700"
              }`}>{fmt(txnTotalCw - txnTotalBc)}</td>
            </tr>
          </tbody>
        </table>
      )}
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
    tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function JeRow({
  account,
  fallbackName,
  debit,
  credit,
}: {
  account: PostableAccount | null;
  fallbackName: string;
  debit: number;
  credit: number;
}) {
  return (
    <tr>
      <td className="py-1 font-mono text-[11px] text-slate-500">
        {account?.number ?? "—"}
      </td>
      <td className="py-1">
        {account?.displayName ?? (
          <span className="italic text-slate-400">{fallbackName} (unassigned)</span>
        )}
      </td>
      <td className="py-1 text-right tabular-nums">
        {debit === 0 ? "—" : fmt(debit)}
      </td>
      <td className="py-1 text-right tabular-nums">
        {credit === 0 ? "—" : fmt(credit)}
      </td>
    </tr>
  );
}
