"use client";

import { useEffect, useState } from "react";
import { fmt } from "@/lib/recon";

// Snapshot shape pushed from the Payroll Allocation page via localStorage.
// Mirror of gustoJe.JournalEntry + a dept roll-up.
type JeSummaryRow = {
  lineItem: string;
  debit: number;
  credit: number;
  account: string;
  accountName: string;
};
type Bucket =
  | "managed"
  | "recurring"
  | "nonRecurring"
  | "voip"
  | "sales"
  | "admin";
type BucketRow = {
  lineItem: string;
  byBucket: Record<Bucket, number>;
  total: number;
  accountByBucket: Record<Bucket, string>;
};
type AccruedPayrollSnapshot = {
  periodLabel: string;
  periodEnd: string; // YYYY-MM-DD of the pay-period end
  generatedAt: string;
  debitTotal: number;
  creditTotal: number;
  bucketRows: BucketRow[];
  summaryRows: JeSummaryRow[];
};

const BUCKET_ORDER: Bucket[] = [
  "managed",
  "recurring",
  "nonRecurring",
  "voip",
  "sales",
  "admin",
];

const BUCKET_LABELS: Record<Bucket, string> = {
  managed: "Managed Services",
  recurring: "Re-occurring",
  nonRecurring: "Non-recurring",
  voip: "VOIP",
  sales: "Sales",
  admin: "Admin",
};

const STORAGE_KEY = "accruedPayrollSnapshot";

type Props = { periodEnd: string };

export default function AccruedPayrollClient({ periodEnd }: Props) {
  const [snapshot, setSnapshot] = useState<AccruedPayrollSnapshot | null>(null);
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [transactionsDuringMonth, setTransactionsDuringMonth] = useState<number>(0);
  const [tbBalance, setTbBalance] = useState<number>(0);

  // Pull any snapshot the Payroll page pushed into localStorage. Re-reads on
  // tab/focus so you can flip between tabs without losing the snapshot.
  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as AccruedPayrollSnapshot;
        setSnapshot(parsed);
      } catch {
        // ignore
      }
    };
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, []);

  function clearSnapshot() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setSnapshot(null);
  }

  const reconciledBalance = openingBalance + transactionsDuringMonth;
  const variance = tbBalance - reconciledBalance;

  return (
    <div className="space-y-5">
      {!snapshot && (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No Accrued Payroll data yet. Go to{" "}
          <a className="underline font-medium" href="/data-prep/payroll">
            Payroll Allocation
          </a>
          , upload the Gusto CSV, click <span className="font-semibold">Generate JE</span>,
          then <span className="font-semibold">Copy to Accrued Payroll Report</span>.
        </div>
      )}

      {/* Reconciliation panel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
        <div className="rounded border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
            Account Reconciliation — Accrued Payroll (202010)
          </div>
          <table className="w-full text-sm">
            <tbody>
              <ReconRow
                label="Opening balance"
                value={openingBalance}
                source="Gusto Report"
                editable
                onChange={setOpeningBalance}
              />
              <ReconRow
                label="Transactions during month"
                value={transactionsDuringMonth}
                source={snapshot ? "From Payroll Allocation" : "— (populate from JE)"}
                editable
                onChange={setTransactionsDuringMonth}
              />
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <td className="px-4 py-2">Reconciled Balance</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmt(reconciledBalance)}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">Rx</td>
              </tr>
              <ReconRow
                label="Balance per Unadjusted TB"
                value={tbBalance}
                source="Gravity BS"
                editable
                onChange={setTbBalance}
              />
              <tr>
                <td className="px-4 py-1 text-slate-700">Adjustment</td>
                <td className="px-4 py-1 text-right tabular-nums text-slate-500">
                  {fmt(0)}
                </td>
                <td />
              </tr>
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <td className="px-4 py-2">Balance per Adjusted TB</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmt(tbBalance)}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">Gravity BS</td>
              </tr>
              <tr>
                <td className="px-4 py-1 font-medium text-slate-900">Variance</td>
                <td
                  className={`px-4 py-1 text-right tabular-nums font-semibold ${
                    Math.abs(variance) < 0.01
                      ? "text-emerald-700"
                      : "text-red-700"
                  }`}
                >
                  {fmt(variance)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        {/* JE panel */}
        <div className="rounded border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
            <div className="text-sm font-semibold text-slate-700">
              Adjusting Entry — To Accrue Payroll Liabilities
            </div>
            {snapshot && (
              <div className="flex gap-2">
                <span className="text-xs text-slate-500">
                  {snapshot.periodLabel} · copied {new Date(snapshot.generatedAt).toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={clearSnapshot}
                  className="text-xs text-slate-500 hover:text-slate-900"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
          {snapshot ? (
            <JeTable snapshot={snapshot} />
          ) : (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              JE will appear here once copied from the Payroll Allocation page.
            </div>
          )}
        </div>
      </div>

      {/* Dept-grouped detail (mirrors BS-Recon spreadsheet layout) */}
      {snapshot && <DeptGroupedView snapshot={snapshot} />}
    </div>
  );
}

function ReconRow({
  label,
  value,
  source,
  editable,
  onChange,
}: {
  label: string;
  value: number;
  source: string;
  editable?: boolean;
  onChange?: (v: number) => void;
}) {
  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-1.5 text-slate-700">{label}</td>
      <td className="px-4 py-1.5 text-right tabular-nums">
        {editable ? (
          <input
            type="number"
            step="0.01"
            value={value || ""}
            onChange={(e) => onChange?.(Number(e.target.value) || 0)}
            className="w-32 rounded border border-slate-300 px-2 py-0.5 text-right font-mono text-xs"
          />
        ) : (
          fmt(value)
        )}
      </td>
      <td className="px-4 py-1.5 text-xs text-slate-500">{source}</td>
    </tr>
  );
}

function JeTable({ snapshot }: { snapshot: AccruedPayrollSnapshot }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-white text-slate-600">
        <tr>
          <th className="px-3 py-2 text-left font-medium w-[80px]">Acct</th>
          <th className="px-3 py-2 text-left font-medium">Name</th>
          <th className="px-3 py-2 text-left font-medium">Line</th>
          <th className="px-3 py-2 text-right font-medium w-[110px]">Debit</th>
          <th className="px-3 py-2 text-right font-medium w-[110px]">Credit</th>
        </tr>
      </thead>
      <tbody>
        {snapshot.summaryRows.map((r, i) => (
          <tr key={`${r.account}-${i}`} className="border-t border-slate-100">
            <td className="px-3 py-1 font-mono text-xs">{r.account}</td>
            <td className="px-3 py-1 text-slate-700">{r.accountName}</td>
            <td className="px-3 py-1 text-xs text-slate-500">{r.lineItem}</td>
            <td className="px-3 py-1 text-right tabular-nums">
              {r.debit ? fmt(r.debit) : ""}
            </td>
            <td className="px-3 py-1 text-right tabular-nums">
              {r.credit ? fmt(r.credit) : ""}
            </td>
          </tr>
        ))}
        <tr className="border-t-2 border-slate-700 bg-slate-50 font-semibold">
          <td className="px-3 py-2" colSpan={3}>
            Totals
          </td>
          <td className="px-3 py-2 text-right tabular-nums">
            {fmt(snapshot.debitTotal)}
          </td>
          <td className="px-3 py-2 text-right tabular-nums">
            {fmt(snapshot.creditTotal)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function DeptGroupedView({ snapshot }: { snapshot: AccruedPayrollSnapshot }) {
  return (
    <div className="rounded border border-slate-200 bg-white overflow-x-auto">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
        Bucket breakdown (mirrors BS-Recon Accrued Payroll tab)
      </div>
      <table className="w-full text-sm">
        <thead className="bg-white text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Line item</th>
            {BUCKET_ORDER.map((b) => (
              <th key={b} className="px-3 py-2 text-right font-medium">
                {BUCKET_LABELS[b]}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.bucketRows.map((row) => (
            <tr key={row.lineItem} className="border-t border-slate-100">
              <td className="px-3 py-1.5 text-slate-900">{row.lineItem}</td>
              {BUCKET_ORDER.map((b) => {
                const amt = row.byBucket[b];
                const acct = row.accountByBucket[b];
                return (
                  <td
                    key={b}
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      amt ? "text-slate-900" : "text-slate-300"
                    }`}
                    title={`Posts to ${acct}`}
                  >
                    <div>{fmt(amt)}</div>
                    <div className="font-mono text-[10px] text-slate-500">
                      {acct}
                    </div>
                  </td>
                );
              })}
              <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                {fmt(row.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
