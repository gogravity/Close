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
  netIncome: Record<MonthKey, number>;
};

type ErrResponse = { ok: false; error: string; status?: number; body?: unknown };

type SubaccountAccountRow = {
  accountNumber: string;
  accountName: string;
  category: Category;
  monthly: Record<MonthKey, number>;
};

type SubaccountBucket = {
  code: string;
  label: string;
  accounts: SubaccountAccountRow[];
  monthly: Record<MonthKey, number>;
};

const NO_SUBACCOUNT_CODE = "__none__";

function pivotBySubaccount(
  categories: CategoryGroup[],
  months: MonthKey[]
): SubaccountBucket[] {
  const buckets = new Map<string, SubaccountBucket>();
  const ensureBucket = (code: string, label: string) => {
    let b = buckets.get(code);
    if (!b) {
      b = {
        code,
        label,
        accounts: [],
        monthly: Object.fromEntries(months.map((m) => [m, 0])),
      };
      buckets.set(code, b);
    }
    return b;
  };

  for (const cat of categories) {
    for (const acct of cat.accounts) {
      if (acct.hasSubaccounts && acct.subaccounts.length > 0) {
        for (const sub of acct.subaccounts) {
          const b = ensureBucket(sub.subaccount.code, sub.subaccount.label);
          b.accounts.push({
            accountNumber: acct.accountNumber,
            accountName: acct.accountName,
            category: acct.category,
            monthly: sub.monthly,
          });
          for (const m of months) b.monthly[m] += sub.monthly[m] ?? 0;
        }
      } else {
        const b = ensureBucket(NO_SUBACCOUNT_CODE, "(no subaccount)");
        b.accounts.push({
          accountNumber: acct.accountNumber,
          accountName: acct.accountName,
          category: acct.category,
          monthly: acct.monthly,
        });
        for (const m of months) b.monthly[m] += acct.monthly[m] ?? 0;
      }
    }
  }

  // Sort: named subaccounts first (by label), "(no subaccount)" last
  return Array.from(buckets.values()).sort((a, b) => {
    if (a.code === NO_SUBACCOUNT_CODE) return 1;
    if (b.code === NO_SUBACCOUNT_CODE) return -1;
    return a.label.localeCompare(b.label);
  });
}

type Props = { defaultEndMonth: string };

export default function PlBySubaccountClient({ defaultEndMonth }: Props) {
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

  const buckets = useMemo(() => {
    if (!result) return [];
    return pivotBySubaccount(result.categories, result.months);
  }, [result]);

  const months = result?.months ?? [];
  const currentMonth = months[months.length - 1];
  const priorMonth = months[months.length - 2];

  function mom(bucketMonthly: Record<MonthKey, number>) {
    if (!currentMonth || !priorMonth) return { dollars: 0, pct: 0 };
    const cur = bucketMonthly[currentMonth] ?? 0;
    const pri = bucketMonthly[priorMonth] ?? 0;
    const dollars = cur - pri;
    const pct = pri !== 0 ? dollars / Math.abs(pri) : 0;
    return { dollars, pct };
  }

  const grand = useMemo(() => {
    if (!result) return null;
    const m: Record<MonthKey, number> = Object.fromEntries(months.map((k) => [k, 0]));
    for (const b of buckets) for (const k of months) m[k] += b.monthly[k] ?? 0;
    return m;
  }, [buckets, result, months]);

  function toggle(code: string) {
    setExpanded((p) => ({ ...p, [code]: !(p[code] ?? false) }));
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
          className="ml-auto rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? "Running…" : "Run"}
        </button>
      </div>

      {err && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <div className="font-medium">Failed to compute P&amp;L by subaccount</div>
          <div className="mt-1 text-xs text-red-700">{err.error}</div>
        </div>
      )}

      {!result && !loading && !err && (
        <div className="rounded border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Pick an end month and click Run to view P&amp;L pivoted by subaccount / department
          with month-over-month variance.
        </div>
      )}

      {result && grand && (
        <div className="rounded border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Subaccount / Account</th>
                {months.map((m) => (
                  <th key={m} className="px-3 py-2 text-right font-medium tabular-nums w-[110px]">
                    {m}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium tabular-nums w-[110px]">
                  MoM $
                </th>
                <th className="px-3 py-2 text-right font-medium tabular-nums w-[80px]">
                  MoM %
                </th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => {
                const isOpen = expanded[b.code] ?? false;
                const { dollars, pct } = mom(b.monthly);
                const tone =
                  Math.abs(dollars) < 0.01
                    ? "text-slate-500"
                    : dollars >= 0
                    ? "text-emerald-700"
                    : "text-amber-700";
                return (
                  <>
                    <tr
                      key={b.code}
                      className="border-t border-slate-200 bg-slate-50/40 cursor-pointer hover:bg-slate-100"
                      onClick={() => toggle(b.code)}
                    >
                      <td className="px-3 py-1.5 font-semibold">
                        <span className="mr-1 text-slate-400">{isOpen ? "▾" : "▸"}</span>
                        {b.label}
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          ({b.accounts.length} account{b.accounts.length === 1 ? "" : "s"})
                        </span>
                      </td>
                      {months.map((m) => (
                        <td key={m} className="px-3 py-1.5 text-right tabular-nums font-medium">
                          {fmt(b.monthly[m] ?? 0)}
                        </td>
                      ))}
                      <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${tone}`}>
                        {fmt(dollars)}
                      </td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${tone}`}>
                        {(pct * 100).toFixed(1)}%
                      </td>
                    </tr>
                    {isOpen &&
                      b.accounts
                        .slice()
                        .sort((x, y) => x.accountNumber.localeCompare(y.accountNumber))
                        .map((a) => {
                          const am = mom(a.monthly);
                          const atone =
                            Math.abs(am.dollars) < 0.01
                              ? "text-slate-400"
                              : am.dollars >= 0
                              ? "text-emerald-700"
                              : "text-amber-700";
                          return (
                            <tr
                              key={`${b.code}-${a.accountNumber}`}
                              className="border-t border-slate-100"
                            >
                              <td className="px-3 py-1 pl-8 text-slate-700">
                                <span className="font-mono text-[11px] text-slate-500 mr-2">
                                  {a.accountNumber}
                                </span>
                                {a.accountName}
                                <span className="ml-2 text-[11px] text-slate-400">
                                  · {a.category === "CostOfGoodsSold" ? "COGS" : a.category}
                                </span>
                              </td>
                              {months.map((m) => (
                                <td key={m} className="px-3 py-1 text-right tabular-nums text-slate-700">
                                  {a.monthly[m] !== 0 ? fmt(a.monthly[m] ?? 0) : ""}
                                </td>
                              ))}
                              <td className={`px-3 py-1 text-right tabular-nums ${atone}`}>
                                {Math.abs(am.dollars) < 0.01 ? "" : fmt(am.dollars)}
                              </td>
                              <td className={`px-3 py-1 text-right tabular-nums ${atone}`}>
                                {Math.abs(am.dollars) < 0.01 ? "" : `${(am.pct * 100).toFixed(1)}%`}
                              </td>
                            </tr>
                          );
                        })}
                  </>
                );
              })}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <td className="px-3 py-1.5">Grand Total</td>
                {months.map((m) => (
                  <td key={m} className="px-3 py-1.5 text-right tabular-nums">
                    {fmt(grand[m] ?? 0)}
                  </td>
                ))}
                {(() => {
                  const g = mom(grand);
                  const tone =
                    Math.abs(g.dollars) < 0.01
                      ? "text-slate-500"
                      : g.dollars >= 0
                      ? "text-emerald-700"
                      : "text-amber-700";
                  return (
                    <>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${tone}`}>
                        {fmt(g.dollars)}
                      </td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${tone}`}>
                        {(g.pct * 100).toFixed(1)}%
                      </td>
                    </>
                  );
                })()}
              </tr>
            </tbody>
          </table>
          <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
            {currentMonth && priorMonth
              ? `MoM variance = ${currentMonth} − ${priorMonth}. `
              : ""}
            Positive variance shown green, negative amber. Click a subaccount row to expand accounts.
          </div>
        </div>
      )}
    </div>
  );
}
