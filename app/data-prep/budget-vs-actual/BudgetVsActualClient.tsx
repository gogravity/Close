"use client";

import { useEffect, useMemo, useState } from "react";
import { fmt } from "@/lib/recon";

type Category = "Income" | "CostOfGoodsSold" | "Expense";

type BudgetOption = { name: string; description: string };

type Row = {
  accountNumber: string;
  accountName: string;
  category: Category;
  actual: number;
  budget: number;
};

type OkResponse = {
  ok: true;
  budgetName: string;
  startMonth: string;
  endMonth: string;
  budgets: BudgetOption[];
  rows: Row[];
  totalsByCategory: Record<Category, { actual: number; budget: number }>;
};

type ErrResponse = { ok: false; error: string; status?: number; body?: unknown };

type Props = { defaultStartMonth: string; defaultEndMonth: string };

const CATEGORY_ORDER: Category[] = ["Income", "CostOfGoodsSold", "Expense"];
const CATEGORY_LABEL: Record<Category, string> = {
  Income: "Revenue",
  CostOfGoodsSold: "Cost of Goods Sold",
  Expense: "Operating Expense",
};

function varianceTone(actual: number, budget: number, cat: Category): string {
  const diff = actual - budget;
  if (Math.abs(diff) < 0.01) return "text-slate-500";
  // For revenue: positive = favorable (over budget). For expense/COGS: negative = favorable.
  const favorable = cat === "Income" ? diff > 0 : diff < 0;
  return favorable ? "text-emerald-700" : "text-amber-700";
}

export default function BudgetVsActualClient({
  defaultStartMonth,
  defaultEndMonth,
}: Props) {
  const [budgets, setBudgets] = useState<BudgetOption[]>([]);
  const [budgetName, setBudgetName] = useState("");
  const [startMonth, setStartMonth] = useState(defaultStartMonth);
  const [endMonth, setEndMonth] = useState(defaultEndMonth);
  const [loading, setLoading] = useState(false);
  const [loadingBudgets, setLoadingBudgets] = useState(true);
  const [result, setResult] = useState<OkResponse | null>(null);
  const [err, setErr] = useState<ErrResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/budget-vs-actual", { method: "GET" });
        const json = (await res.json()) as
          | { ok: true; budgets: BudgetOption[] }
          | ErrResponse;
        if (cancelled) return;
        if (json.ok) {
          setBudgets(json.budgets);
          if (json.budgets.length > 0 && !budgetName) setBudgetName(json.budgets[0].name);
        } else {
          setErr(json);
        }
      } catch (e) {
        if (!cancelled) setErr({ ok: false, error: (e as Error).message });
      } finally {
        if (!cancelled) setLoadingBudgets(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    if (!budgetName) {
      setErr({ ok: false, error: "Select a budget first" });
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/budget-vs-actual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetName, startMonth, endMonth }),
      });
      const json = (await res.json()) as OkResponse | ErrResponse;
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

  const grouped = useMemo(() => {
    if (!result) return null;
    const g: Record<Category, Row[]> = { Income: [], CostOfGoodsSold: [], Expense: [] };
    for (const r of result.rows) g[r.category].push(r);
    return g;
  }, [result]);

  function exportCsv() {
    if (!result) return;
    const lines: string[] = [];
    lines.push(`Budget vs Actual,${result.budgetName}`);
    lines.push(`Period,${result.startMonth} to ${result.endMonth}`);
    lines.push("");
    lines.push(["Account #", "Account", "Category", "Actual", "Budget", "Variance $", "Variance %"].join(","));
    const esc = (s: string) =>
      /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    for (const cat of CATEGORY_ORDER) {
      const rows = grouped?.[cat] ?? [];
      for (const r of rows) {
        const v = r.actual - r.budget;
        const pct = r.budget !== 0 ? (v / Math.abs(r.budget)) * 100 : 0;
        lines.push(
          [
            esc(r.accountNumber),
            esc(r.accountName),
            cat,
            r.actual.toFixed(2),
            r.budget.toFixed(2),
            v.toFixed(2),
            pct.toFixed(1),
          ].join(",")
        );
      }
      const t = result.totalsByCategory[cat];
      const v = t.actual - t.budget;
      const pct = t.budget !== 0 ? (v / Math.abs(t.budget)) * 100 : 0;
      lines.push(
        ["", `Total ${CATEGORY_LABEL[cat]}`, cat, t.actual.toFixed(2), t.budget.toFixed(2), v.toFixed(2), pct.toFixed(1)].join(",")
      );
    }
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-vs-actual-${result.budgetName}-${result.startMonth}-to-${result.endMonth}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded border border-slate-200 bg-white px-4 py-3">
        <label className="text-sm min-w-[240px]">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Budget
          </div>
          <select
            value={budgetName}
            onChange={(e) => setBudgetName(e.target.value)}
            disabled={loadingBudgets || budgets.length === 0}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {loadingBudgets ? (
              <option>Loading budgets…</option>
            ) : budgets.length === 0 ? (
              <option>No budgets found</option>
            ) : (
              budgets.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                  {b.description ? ` — ${b.description}` : ""}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Start Month
          </div>
          <input
            type="month"
            value={startMonth}
            onChange={(e) => setStartMonth(e.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
        <label className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            End Month
          </div>
          <input
            type="month"
            value={endMonth}
            onChange={(e) => setEndMonth(e.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
        <button
          onClick={run}
          disabled={loading || !budgetName}
          className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? "Running…" : "Run"}
        </button>
        {result && (
          <button
            onClick={exportCsv}
            className="ml-auto rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Export CSV
          </button>
        )}
      </div>

      {err && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <div className="font-medium">Failed to load Budget vs Actual</div>
          <div className="mt-1 text-xs text-red-700 whitespace-pre-wrap break-all">
            {err.error}
            {err.status ? ` (HTTP ${err.status})` : ""}
          </div>
          {err.status === 404 && (
            <div className="mt-2 text-xs text-red-700">
              If the budget API returns 404, the <code>reportsFinance/beta</code> API may
              not be enabled for this environment. In BC admin: Extension Management →
              ensure the <em>Financial Reports API</em> app is installed.
            </div>
          )}
        </div>
      )}

      {!result && !loading && !err && (
        <div className="rounded border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Pick a budget and date range, then click Run to compare against actuals.
        </div>
      )}

      {result && grouped && (
        <div className="rounded border border-slate-200 bg-white overflow-x-auto">
          <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
            {result.budgetName} — {result.startMonth} → {result.endMonth}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Account</th>
                <th className="px-3 py-2 text-right font-medium w-[130px]">Actual</th>
                <th className="px-3 py-2 text-right font-medium w-[130px]">Budget</th>
                <th className="px-3 py-2 text-right font-medium w-[130px]">Variance $</th>
                <th className="px-3 py-2 text-right font-medium w-[90px]">Variance %</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORY_ORDER.map((cat) => {
                const rows = grouped[cat];
                const t = result.totalsByCategory[cat];
                if (rows.length === 0 && t.actual === 0 && t.budget === 0) return null;
                const tDiff = t.actual - t.budget;
                const tPct = t.budget !== 0 ? (tDiff / Math.abs(t.budget)) * 100 : 0;
                return (
                  <>
                    <tr key={`${cat}-head`} className="border-t border-slate-200 bg-slate-50/60">
                      <td colSpan={5} className="px-3 py-1.5 font-semibold uppercase tracking-wide text-xs text-slate-700">
                        {CATEGORY_LABEL[cat]}
                      </td>
                    </tr>
                    {rows.map((r) => {
                      const diff = r.actual - r.budget;
                      const pct = r.budget !== 0 ? (diff / Math.abs(r.budget)) * 100 : 0;
                      const tone = varianceTone(r.actual, r.budget, cat);
                      return (
                        <tr key={`${cat}-${r.accountNumber}`} className="border-t border-slate-100">
                          <td className="px-3 py-1">
                            <span className="font-mono text-[11px] text-slate-500 mr-2">
                              {r.accountNumber}
                            </span>
                            {r.accountName}
                          </td>
                          <td className="px-3 py-1 text-right tabular-nums">{fmt(r.actual)}</td>
                          <td className="px-3 py-1 text-right tabular-nums">{fmt(r.budget)}</td>
                          <td className={`px-3 py-1 text-right tabular-nums ${tone}`}>
                            {fmt(diff)}
                          </td>
                          <td className={`px-3 py-1 text-right tabular-nums ${tone}`}>
                            {r.budget !== 0 ? `${pct.toFixed(1)}%` : ""}
                          </td>
                        </tr>
                      );
                    })}
                    <tr key={`${cat}-total`} className="border-t border-slate-200 bg-slate-50/40 font-semibold">
                      <td className="px-3 py-1.5">Total {CATEGORY_LABEL[cat]}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(t.actual)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(t.budget)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${varianceTone(t.actual, t.budget, cat)}`}>
                        {fmt(tDiff)}
                      </td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${varianceTone(t.actual, t.budget, cat)}`}>
                        {t.budget !== 0 ? `${tPct.toFixed(1)}%` : ""}
                      </td>
                    </tr>
                  </>
                );
              })}
              {(() => {
                const net = {
                  actual:
                    result.totalsByCategory.Income.actual -
                    result.totalsByCategory.CostOfGoodsSold.actual -
                    result.totalsByCategory.Expense.actual,
                  budget:
                    result.totalsByCategory.Income.budget -
                    result.totalsByCategory.CostOfGoodsSold.budget -
                    result.totalsByCategory.Expense.budget,
                };
                const diff = net.actual - net.budget;
                const pct = net.budget !== 0 ? (diff / Math.abs(net.budget)) * 100 : 0;
                const tone =
                  Math.abs(diff) < 0.01
                    ? "text-slate-500"
                    : diff >= 0
                    ? "text-emerald-700"
                    : "text-amber-700";
                return (
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                    <td className="px-3 py-1.5">Net Income</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(net.actual)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(net.budget)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${tone}`}>
                      {fmt(diff)}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${tone}`}>
                      {net.budget !== 0 ? `${pct.toFixed(1)}%` : ""}
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
          <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
            Favorable variance shown green (revenue over budget, or expense under).
            Amber = unfavorable. Budget amounts are signed per BC convention and
            normalized to match actuals.
          </div>
        </div>
      )}
    </div>
  );
}
