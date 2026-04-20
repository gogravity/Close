"use client";

import { useState } from "react";
import { fmt } from "@/lib/recon";
import MetricCard from "@/components/MetricCard";

type InvoiceEntry = {
  invoiceNumber: string;
  date: string;
  amount: number;
  source: "cw" | "bc" | "both";
  status: "match" | "amount-mismatch" | "missing-cw" | "missing-bc";
  cwAmount: number | null;
  bcAmount: number | null;
};

type CustomerGroup = {
  customerKey: string;
  customerName: string;
  cwTotal: number;
  bcTotal: number;
  discrepancyCount: number;
  invoiceCount: number;
  invoices: InvoiceEntry[];
};

type ReconResponse = {
  ok: true;
  monthA: { year: number; month: number; start: string; end: string };
  monthB: { year: number; month: number; start: string; end: string };
  customers: CustomerGroup[];
  totals: { cw: number; bc: number; discrepancies: number; customers: number; invoices: number };
};

type ErrorResponse = { ok: false; error: string; status?: number; body?: unknown };

type Props = {
  defaultMonthA: string;
  defaultMonthB: string;
};

export default function InvoiceValidationClient({ defaultMonthA, defaultMonthB }: Props) {
  const [monthA, setMonthA] = useState(defaultMonthA);
  const [monthB, setMonthB] = useState(defaultMonthB);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReconResponse | null>(null);
  const [err, setErr] = useState<ErrorResponse | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showOnlyDiscrepancies, setShowOnlyDiscrepancies] = useState(false);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/invoice-validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthA, monthB }),
      });
      const json = (await res.json()) as ReconResponse | ErrorResponse;
      if (!json.ok) {
        setErr(json);
        setResult(null);
      } else {
        setResult(json);
      }
    } catch (e) {
      setErr({ ok: false, error: (e as Error).message });
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const visibleCustomers = result
    ? showOnlyDiscrepancies
      ? result.customers.filter((c) => c.discrepancyCount > 0)
      : result.customers
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded border border-slate-200 bg-white px-4 py-3">
        <label className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Month A</div>
          <input
            type="month"
            value={monthA}
            onChange={(e) => setMonthA(e.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
        <label className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Month B</div>
          <input
            type="month"
            value={monthB}
            onChange={(e) => setMonthB(e.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={loading || !monthA || !monthB}
          className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Running…" : "Run reconciliation"}
        </button>
        {result && (
          <label className="ml-auto flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={showOnlyDiscrepancies}
              onChange={(e) => setShowOnlyDiscrepancies(e.target.checked)}
            />
            Only customers with discrepancies
          </label>
        )}
      </div>

      {err && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <div className="font-medium">Reconciliation failed</div>
          <div className="mt-1 font-mono text-xs">{err.error}</div>
          {err.body ? (
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-white p-2 text-[11px]">
              {JSON.stringify(err.body, null, 2)}
            </pre>
          ) : null}
        </div>
      )}

      {result && (
        <>
          <div className="grid grid-cols-5 gap-3">
            <MetricCard label="Customers" value={result.totals.customers} />
            <MetricCard label="Invoices matched" value={result.totals.invoices} />
            <MetricCard label="CW total" value={fmt(result.totals.cw)} />
            <MetricCard label="BC total" value={fmt(result.totals.bc)} />
            <MetricCard
              label="Discrepancies"
              value={result.totals.discrepancies}
              tone={result.totals.discrepancies > 0 ? "warn" : "ok"}
            />
          </div>

          <div className="rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <th className="px-3 py-2 text-left font-medium">Customer</th>
                  <th className="px-3 py-2 text-right font-medium">Invoices</th>
                  <th className="px-3 py-2 text-right font-medium">CW Total</th>
                  <th className="px-3 py-2 text-right font-medium">BC Total</th>
                  <th className="px-3 py-2 text-right font-medium">Variance</th>
                  <th className="px-3 py-2 text-right font-medium">Discrepancies</th>
                </tr>
              </thead>
              <tbody>
                {visibleCustomers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                      No customers to display for the selected months.
                    </td>
                  </tr>
                )}
                {visibleCustomers.map((c) => {
                  const isOpen = expanded[c.customerKey] ?? false;
                  const variance = c.cwTotal - c.bcTotal;
                  return (
                    <RowsForCustomer
                      key={c.customerKey}
                      customer={c}
                      isOpen={isOpen}
                      variance={variance}
                      onToggle={() =>
                        setExpanded((p) => ({ ...p, [c.customerKey]: !isOpen }))
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function RowsForCustomer({
  customer,
  isOpen,
  variance,
  onToggle,
}: {
  customer: CustomerGroup;
  isOpen: boolean;
  variance: number;
  onToggle: () => void;
}) {
  const hasDisc = customer.discrepancyCount > 0;
  return (
    <>
      <tr
        className={`cursor-pointer border-t border-slate-200 ${
          hasDisc ? "bg-amber-50/40 hover:bg-amber-50" : "hover:bg-slate-50"
        }`}
        onClick={onToggle}
      >
        <td className="px-2 py-2 text-center text-slate-400">{isOpen ? "▾" : "▸"}</td>
        <td className="px-3 py-2 font-medium text-slate-900">{customer.customerName}</td>
        <td className="px-3 py-2 text-right tabular-nums">{customer.invoiceCount}</td>
        <td className="px-3 py-2 text-right tabular-nums">{fmt(customer.cwTotal)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{fmt(customer.bcTotal)}</td>
        <td
          className={`px-3 py-2 text-right tabular-nums ${
            Math.abs(variance) >= 0.01 ? "font-medium text-amber-700" : "text-slate-500"
          }`}
        >
          {fmt(variance)}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {hasDisc ? (
            <span className="inline-flex rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
              {customer.discrepancyCount}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={7} className="bg-slate-50 px-4 py-2">
            <InvoiceTable invoices={customer.invoices} />
          </td>
        </tr>
      )}
    </>
  );
}

function InvoiceTable({ invoices }: { invoices: InvoiceEntry[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-slate-500">
        <tr>
          <th className="px-2 py-1 text-left font-medium">Date</th>
          <th className="px-2 py-1 text-left font-medium">Invoice #</th>
          <th className="px-2 py-1 text-right font-medium">CW Amount</th>
          <th className="px-2 py-1 text-right font-medium">BC Amount</th>
          <th className="px-2 py-1 text-right font-medium">Variance</th>
          <th className="px-2 py-1 text-left font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((inv) => {
          const variance = (inv.cwAmount ?? 0) - (inv.bcAmount ?? 0);
          const rowClass =
            inv.status === "missing-cw" || inv.status === "missing-bc"
              ? "bg-red-50 hover:bg-red-100"
              : inv.status === "amount-mismatch"
                ? "bg-amber-50 hover:bg-amber-100"
                : "hover:bg-white";
          return (
            <tr key={`${inv.invoiceNumber}-${inv.date}`} className={`border-t border-slate-200 ${rowClass}`}>
              <td className="px-2 py-1 font-mono text-slate-600">{inv.date}</td>
              <td className="px-2 py-1 font-mono">{inv.invoiceNumber}</td>
              <td className="px-2 py-1 text-right tabular-nums">
                {inv.cwAmount === null ? (
                  <span className="text-red-700">—</span>
                ) : (
                  fmt(inv.cwAmount)
                )}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                {inv.bcAmount === null ? (
                  <span className="text-red-700">—</span>
                ) : (
                  fmt(inv.bcAmount)
                )}
              </td>
              <td
                className={`px-2 py-1 text-right tabular-nums ${
                  inv.status === "match" ? "text-slate-400" : "font-medium text-amber-700"
                }`}
              >
                {inv.status === "match" ? "—" : fmt(variance)}
              </td>
              <td className="px-2 py-1 text-slate-700">{statusLabel(inv.status)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function statusLabel(s: InvoiceEntry["status"]): string {
  switch (s) {
    case "match":
      return "Matched";
    case "amount-mismatch":
      return "Amount mismatch";
    case "missing-cw":
      return "Missing in CW";
    case "missing-bc":
      return "Missing in BC";
  }
}

