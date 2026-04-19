"use client";

import { useMemo } from "react";
import { fmt } from "@/lib/recon";

type Customer = {
  customerNumber: string;
  name: string;
  balanceDue: number;
  currentAmount: number;
  period1Amount: number;
  period2Amount: number;
  period3Amount: number;
};

type Totals = {
  balanceDue: number;
  current: number;
  period1: number;
  period2: number;
  period3: number;
};

export type PostableAccount = {
  number: string;
  displayName: string;
};

type Props = {
  periodEnd: string;
  asOfDate: string;
  periodLengthFilter: string;
  totals: Totals;
  customers: Customer[];
  arGlBalance: number;
  allowanceAccount: PostableAccount | null;   // the mapped allowance acct (e.g. 101020)
  allowanceGlBalance: number;
  badDebtAccount: PostableAccount | null;      // auto-detected from BC chart
  initialInput: {
    allowanceRates: { current: number; period1: number; period2: number; period3: number };
    notes?: string;
  };
  hideCustomerDetail?: boolean;
};

function toPct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

export default function ArReconClient({
  periodEnd,
  asOfDate,
  periodLengthFilter,
  totals,
  customers,
  arGlBalance,
  allowanceAccount,
  allowanceGlBalance,
  badDebtAccount,
  initialInput,
  hideCustomerDetail,
}: Props) {
  // Allowance rates are set by Lyra corporate policy and are not editable.
  const rates = initialInput.allowanceRates;

  const allowanceByBucket = useMemo(
    () => ({
      current: totals.current * rates.current,
      period1: totals.period1 * rates.period1,
      period2: totals.period2 * rates.period2,
      period3: totals.period3 * rates.period3,
    }),
    [totals, rates]
  );
  const expectedAllowance =
    allowanceByBucket.current +
    allowanceByBucket.period1 +
    allowanceByBucket.period2 +
    allowanceByBucket.period3;

  // Allowance is stored as a negative number in GL (contra-asset).
  const currentAllowance = Math.abs(allowanceGlBalance);
  const adjustment = expectedAllowance - currentAllowance;
  const materialAdjustment = Math.abs(adjustment) >= 0.01;


  function setRate(k: keyof typeof rates, v: number) {
    setRates((r) => ({ ...r, [k]: v }));
  }

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
          Aging & Allowance — as of {asOfDate} ({periodLengthFilter} buckets)
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
                { key: "period1", label: "31 - 60 days", amt: totals.period1, rate: rates.period1, alw: allowanceByBucket.period1 },
                { key: "period2", label: "61 - 90 days", amt: totals.period2, rate: rates.period2, alw: allowanceByBucket.period2 },
                { key: "period3", label: "Over 90 days", amt: totals.period3, rate: rates.period3, alw: allowanceByBucket.period3 },
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
                <th className="px-3 py-2 text-right font-medium">31-60</th>
                <th className="px-3 py-2 text-right font-medium">61-90</th>
                <th className="px-3 py-2 text-right font-medium">91+</th>
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
                  <td className="px-3 py-1 text-right tabular-nums">{c.currentAmount === 0 ? "" : fmt(c.currentAmount)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{c.period1Amount === 0 ? "" : fmt(c.period1Amount)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{c.period2Amount === 0 ? "" : fmt(c.period2Amount)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{c.period3Amount === 0 ? "" : fmt(c.period3Amount)}</td>
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
