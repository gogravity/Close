"use client";

import { useMemo, useState } from "react";
import { fmt } from "@/lib/recon";

type MonthKey = string;
type Category = "Income" | "CostOfGoodsSold" | "Expense";

type SubaccountRow = {
  subaccount: { code: string; label: string };
  monthly: Record<MonthKey, number>;
};

type AccountGroup = {
  accountNumber: string;
  accountName: string;
  category: Category;
  monthly: Record<MonthKey, number>;
  hasSubaccounts: boolean;
  subaccounts: SubaccountRow[];
};

type CategoryGroup = {
  category: Category;
  label: string;
  accounts: AccountGroup[];
  monthly: Record<MonthKey, number>;
};

type OkResponse = {
  ok: true;
  months: MonthKey[];
  categories: CategoryGroup[];
};

type ErrResponse = { ok: false; error: string; status?: number; body?: unknown };

type Props = { defaultEndMonth: string };

export default function MrrTrackerClient({ defaultEndMonth }: Props) {
  const [endMonth, setEndMonth] = useState(defaultEndMonth);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OkResponse | null>(null);
  const [err, setErr] = useState<ErrResponse | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/pl-comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endMonth }),
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

  const months = result?.months ?? [];
  const currentMonth = months[months.length - 1];
  const priorMonth = months[months.length - 2];

  // Only recurring revenue accounts (400xxx, 402xxx).
  // Non-recurring accounts (403xxx T&M, 405xxx Professional Services,
  // 407xxx Hardware/Software Resale) are excluded from MRR tracking.
  const MRR_PREFIXES = ["400", "402"];

  const incomeAccounts = useMemo(() => {
    if (!result) return [];
    const income = result.categories.find((c) => c.category === "Income");
    return (income?.accounts ?? []).filter((a) =>
      MRR_PREFIXES.some((p) => a.accountNumber.startsWith(p))
    );
  }, [result]);

  const totals = useMemo(() => {
    const m: Record<MonthKey, number> = Object.fromEntries(months.map((k) => [k, 0]));
    for (const a of incomeAccounts) for (const k of months) m[k] += a.monthly[k] ?? 0;
    return m;
  }, [incomeAccounts, months]);

  function mom(monthly: Record<MonthKey, number>): { dollars: number; pct: number } {
    if (!currentMonth || !priorMonth) return { dollars: 0, pct: 0 };
    const cur = monthly[currentMonth] ?? 0;
    const pri = monthly[priorMonth] ?? 0;
    const dollars = cur - pri;
    const pct = pri !== 0 ? dollars / Math.abs(pri) : 0;
    return { dollars, pct };
  }

  function toggle(k: string) {
    setExpanded((p) => ({ ...p, [k]: !(p[k] ?? false) }));
  }

  function tone(diff: number) {
    if (Math.abs(diff) < 0.01) return "text-slate-500";
    return diff >= 0 ? "text-emerald-700" : "text-amber-700";
  }

  function exportCsv() {
    if (!result) return;
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines: string[] = [];
    lines.push(`MRR Tracker,End month ${endMonth}`);
    lines.push("");
    lines.push(
      [
        "Account #",
        "Account",
        "Subaccount",
        ...months,
        "MoM $",
        "MoM %",
      ].join(",")
    );
    for (const a of incomeAccounts) {
      const am = mom(a.monthly);
      lines.push(
        [
          esc(a.accountNumber),
          esc(a.accountName),
          "—",
          ...months.map((m) => (a.monthly[m] ?? 0).toFixed(2)),
          am.dollars.toFixed(2),
          (am.pct * 100).toFixed(1),
        ].join(",")
      );
      if (a.hasSubaccounts) {
        for (const s of a.subaccounts) {
          const sm = mom(s.monthly);
          lines.push(
            [
              esc(a.accountNumber),
              esc(a.accountName),
              esc(s.subaccount.label),
              ...months.map((m) => (s.monthly[m] ?? 0).toFixed(2)),
              sm.dollars.toFixed(2),
              (sm.pct * 100).toFixed(1),
            ].join(",")
          );
        }
      }
    }
    const tm = mom(totals);
    lines.push(
      [
        "",
        "Total MRR",
        "",
        ...months.map((m) => (totals[m] ?? 0).toFixed(2)),
        tm.dollars.toFixed(2),
        (tm.pct * 100).toFixed(1),
      ].join(",")
    );
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mrr-tracker-${endMonth}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded border border-slate-200 bg-white px-4 py-3">
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
          disabled={loading}
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
          <div className="font-medium">Failed to load MRR Tracker</div>
          <div className="mt-1 text-xs text-red-700">{err.error}</div>
        </div>
      )}

      {!result && !loading && !err && (
        <div className="rounded border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Pick an end month and click Run.
        </div>
      )}

      {result && (
        <div className="rounded border border-slate-200 bg-white overflow-x-auto">
          <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
            MRR by Account — ending {endMonth}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Account / Subaccount</th>
                {months.map((m) => (
                  <th key={m} className="px-3 py-2 text-right font-medium tabular-nums w-[110px]">
                    {m}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium tabular-nums w-[110px]">MoM $</th>
                <th className="px-3 py-2 text-right font-medium tabular-nums w-[80px]">MoM %</th>
              </tr>
            </thead>
            <tbody>
              {incomeAccounts.map((a) => {
                const am = mom(a.monthly);
                const atone = tone(am.dollars);
                const isOpen = expanded[a.accountNumber] ?? false;
                const canExpand = a.hasSubaccounts && a.subaccounts.length > 0;
                return (
                  <>
                    <tr
                      key={a.accountNumber}
                      className={`border-t border-slate-200 ${canExpand ? "cursor-pointer hover:bg-slate-50" : ""}`}
                      onClick={() => canExpand && toggle(a.accountNumber)}
                    >
                      <td className="px-3 py-1.5 font-medium">
                        {canExpand && (
                          <span className="mr-1 text-slate-400">{isOpen ? "▾" : "▸"}</span>
                        )}
                        <span className="font-mono text-[11px] text-slate-500 mr-2">
                          {a.accountNumber}
                        </span>
                        {a.accountName}
                      </td>
                      {months.map((m) => (
                        <td key={m} className="px-3 py-1.5 text-right tabular-nums">
                          {fmt(a.monthly[m] ?? 0)}
                        </td>
                      ))}
                      <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${atone}`}>
                        {fmt(am.dollars)}
                      </td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${atone}`}>
                        {(am.pct * 100).toFixed(1)}%
                      </td>
                    </tr>
                    {isOpen &&
                      a.subaccounts.map((s) => {
                        const sm = mom(s.monthly);
                        const stone = tone(sm.dollars);
                        return (
                          <tr
                            key={`${a.accountNumber}-${s.subaccount.code}`}
                            className="border-t border-slate-100 bg-slate-50/40"
                          >
                            <td className="px-3 py-1 pl-10 text-slate-700 text-xs">
                              {s.subaccount.label}
                            </td>
                            {months.map((m) => (
                              <td key={m} className="px-3 py-1 text-right tabular-nums text-slate-700">
                                {s.monthly[m] !== 0 ? fmt(s.monthly[m] ?? 0) : ""}
                              </td>
                            ))}
                            <td className={`px-3 py-1 text-right tabular-nums ${stone}`}>
                              {Math.abs(sm.dollars) < 0.01 ? "" : fmt(sm.dollars)}
                            </td>
                            <td className={`px-3 py-1 text-right tabular-nums ${stone}`}>
                              {Math.abs(sm.dollars) < 0.01 ? "" : `${(sm.pct * 100).toFixed(1)}%`}
                            </td>
                          </tr>
                        );
                      })}
                  </>
                );
              })}
              {(() => {
                const tm = mom(totals);
                const ttone = tone(tm.dollars);
                return (
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                    <td className="px-3 py-1.5">Total MRR</td>
                    {months.map((m) => (
                      <td key={m} className="px-3 py-1.5 text-right tabular-nums">
                        {fmt(totals[m] ?? 0)}
                      </td>
                    ))}
                    <td className={`px-3 py-1.5 text-right tabular-nums ${ttone}`}>
                      {fmt(tm.dollars)}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${ttone}`}>
                      {(tm.pct * 100).toFixed(1)}%
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
          <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
            {currentMonth && priorMonth
              ? `MoM = ${currentMonth} − ${priorMonth}. `
              : ""}
            Click an account with subaccount breakouts (▸) to see departments.
            Pulls from the same P&amp;L dataset as the Monthly Comparison tab, filtered to
            Income.
          </div>
        </div>
      )}
    </div>
  );
}
