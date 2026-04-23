"use client";

import { useState } from "react";
import { fmt } from "@/lib/recon";

type MonthKey = string;

type CustomerRow = {
  counterparty: string;
  monthly: Record<MonthKey, number>;
  avgPrior: number;
  current: number;
  variance: number;
  variancePct: number;
  flagged: boolean;
};

type SubaccountRow = {
  subaccount: { code: string; label: string };
  monthly: Record<MonthKey, number>;
  avgPrior: number;
  current: number;
  variance: number;
  variancePct: number;
  flagged: boolean;
  customers: CustomerRow[];
};

type AccountGroup = {
  accountNumber: string;
  accountName: string;
  category: "Income" | "CostOfGoodsSold" | "Expense";
  monthly: Record<MonthKey, number>;
  hasSubaccounts: boolean;
  subaccounts: SubaccountRow[];
  customers: CustomerRow[];
  avgPrior: number;
  current: number;
  variance: number;
  variancePct: number;
  flagged: boolean;
};

type CategoryGroup = {
  category: "Income" | "CostOfGoodsSold" | "Expense";
  label: string;
  accounts: AccountGroup[];
  monthly: Record<MonthKey, number>;
};

type ServiceTypeOption = { code: string; label: string };

type OkResponse = {
  ok: true;
  months: MonthKey[];
  categories: CategoryGroup[];
  netIncome: Record<MonthKey, number>;
  threshold: { absolute: number; pct: number };
  availableServiceTypes: ServiceTypeOption[];
  appliedServiceTypes: string[] | null;
};

type ErrResponse = { ok: false; error: string; status?: number; body?: unknown };

type Props = { defaultEndMonth: string };

export default function PlComparisonClient({ defaultEndMonth }: Props) {
  const [endMonth, setEndMonth] = useState(defaultEndMonth);
  const [thresholdAbsolute, setThresholdAbsolute] = useState(500);
  const [thresholdPct, setThresholdPct] = useState(0.2);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OkResponse | null>(null);
  const [err, setErr] = useState<ErrResponse | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showOnlyFlagged, setShowOnlyFlagged] = useState(false);
  const [selectedServiceTypes, setSelectedServiceTypes] = useState<string[] | null>(null);
  const [monthsToShow, setMonthsToShow] = useState(1);

  async function run(serviceTypesOverride?: string[] | null) {
    setLoading(true);
    setErr(null);
    const types = serviceTypesOverride === undefined ? selectedServiceTypes : serviceTypesOverride;
    try {
      const res = await fetch("/api/pl-comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endMonth,
          thresholdAbsolute,
          thresholdPct,
          serviceTypes: types,
        }),
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

  function toggleServiceType(code: string) {
    const base = selectedServiceTypes ?? result?.availableServiceTypes.map((o) => o.code) ?? [];
    const next = base.includes(code) ? base.filter((c) => c !== code) : [...base, code];
    // Treat "all selected" as null (no filter) to avoid confusion server-side.
    const allCodes = result?.availableServiceTypes.map((o) => o.code) ?? [];
    const normalized = allCodes.length > 0 && next.length === allCodes.length ? null : next;
    setSelectedServiceTypes(normalized);
  }

  function toggle(k: string) {
    setExpanded((p) => ({ ...p, [k]: !(p[k] ?? false) }));
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
        <label className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Threshold ($)
          </div>
          <input
            type="number"
            value={thresholdAbsolute}
            min={0}
            step={100}
            onChange={(e) => setThresholdAbsolute(Number(e.target.value))}
            className="mt-1 w-28 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
        <label className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Threshold (%)
          </div>
          <input
            type="number"
            value={Math.round(thresholdPct * 100)}
            min={0}
            step={5}
            onChange={(e) => setThresholdPct(Number(e.target.value) / 100)}
            className="mt-1 w-24 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
        <label className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Months to show
          </div>
          <input
            type="number"
            value={monthsToShow}
            min={1}
            max={4}
            step={1}
            onChange={(e) =>
              setMonthsToShow(Math.max(1, Math.min(4, Number(e.target.value) || 1)))
            }
            className="mt-1 w-20 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => run()}
          disabled={loading || !endMonth}
          className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Running…" : "Run comparison"}
        </button>
        {result && (
          <label className="ml-auto flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={showOnlyFlagged}
              onChange={(e) => setShowOnlyFlagged(e.target.checked)}
            />
            Only flagged accounts
          </label>
        )}
      </div>

      {result && result.availableServiceTypes.length > 0 && (
        <ServiceTypeFilter
          options={result.availableServiceTypes}
          selected={selectedServiceTypes}
          onToggle={toggleServiceType}
          onClear={() => setSelectedServiceTypes(null)}
          onApply={() => run()}
        />
      )}

      {err && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <div className="font-medium">Comparison failed</div>
          <div className="mt-1 font-mono text-xs">{err.error}</div>
          {err.body ? (
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-white p-2 text-[11px]">
              {JSON.stringify(err.body, null, 2)}
            </pre>
          ) : null}
        </div>
      )}

      {result && (
        <ResultTable
          result={result}
          monthsToShow={monthsToShow}
          showOnlyFlagged={showOnlyFlagged}
          expanded={expanded}
          onToggle={toggle}
        />
      )}
    </div>
  );
}

function ServiceTypeFilter({
  options,
  selected,
  onToggle,
  onClear,
  onApply,
}: {
  options: ServiceTypeOption[];
  selected: string[] | null;
  onToggle: (code: string) => void;
  onClear: () => void;
  onApply: () => void;
}) {
  const allSelected = selected === null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-4 py-2">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Service Type
      </span>
      <button
        type="button"
        onClick={onClear}
        className={`rounded px-2 py-0.5 text-xs ${
          allSelected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
        }`}
      >
        All
      </button>
      {options.map((o) => {
        const active = allSelected || selected?.includes(o.code);
        return (
          <button
            key={o.code}
            type="button"
            onClick={() => onToggle(o.code)}
            className={`rounded px-2 py-0.5 text-xs ${
              active && !allSelected
                ? "bg-sky-600 text-white"
                : active
                  ? "bg-sky-100 text-sky-800"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}
          >
            {o.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onApply}
        className="ml-auto rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
      >
        Apply filter
      </button>
    </div>
  );
}

function momCell(
  monthly: Record<MonthKey, number>,
  current: MonthKey,
  priorMonth: MonthKey | undefined
): { dollars: number; pct: number; hasPrior: boolean } {
  const cur = monthly[current] ?? 0;
  if (!priorMonth) return { dollars: 0, pct: 0, hasPrior: false };
  const pri = monthly[priorMonth] ?? 0;
  const dollars = cur - pri;
  const pct = pri !== 0 ? dollars / Math.abs(pri) : 0;
  return { dollars, pct, hasPrior: pri !== 0 };
}

function ResultTable({
  result,
  monthsToShow,
  showOnlyFlagged,
  expanded,
  onToggle,
}: {
  result: OkResponse;
  monthsToShow: number;
  showOnlyFlagged: boolean;
  expanded: Record<string, boolean>;
  onToggle: (k: string) => void;
}) {
  const { months: allMonths } = result;
  const current = allMonths[allMonths.length - 1];
  const priorMonth: MonthKey | undefined = allMonths[allMonths.length - 2];
  const months = allMonths.slice(-monthsToShow);
  const netIncomeMoM = momCell(result.netIncome, current, priorMonth);

  return (
    <div className="rounded border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="w-8 px-2 py-2" />
            <th className="px-3 py-2 text-left font-medium">Account</th>
            {months.map((m) => (
              <th
                key={m}
                className={`px-3 py-2 text-right font-medium ${
                  m === current ? "bg-slate-100" : ""
                }`}
              >
                {monthLabel(m)}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium w-[90px]">MoM %</th>
            <th className="px-3 py-2 text-right font-medium">Avg prior</th>
            <th className="px-3 py-2 text-right font-medium">Variance</th>
          </tr>
        </thead>
        <tbody>
          {result.categories.map((cat) => (
            <CategorySection
              key={cat.category}
              cat={cat}
              months={months}
              current={current}
              priorMonth={priorMonth}
              showOnlyFlagged={showOnlyFlagged}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
          <tr className="border-t-2 border-slate-700 bg-slate-50 font-semibold">
            <td className="px-2 py-2" />
            <td className="px-3 py-2">Net Income</td>
            {months.map((m) => (
              <td
                key={m}
                className={`px-3 py-2 text-right tabular-nums ${
                  m === current ? "bg-slate-100" : ""
                }`}
              >
                {fmt(result.netIncome[m] ?? 0)}
              </td>
            ))}
            <td className="px-3 py-2 text-right tabular-nums text-slate-600">
              {netIncomeMoM.hasPrior ? formatPct(netIncomeMoM.pct) : "—"}
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-slate-500">—</td>
            <td className="px-3 py-2 text-right tabular-nums text-slate-500">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CategorySection({
  cat,
  months,
  current,
  priorMonth,
  showOnlyFlagged,
  expanded,
  onToggle,
}: {
  cat: CategoryGroup;
  months: MonthKey[];
  current: MonthKey;
  priorMonth: MonthKey | undefined;
  showOnlyFlagged: boolean;
  expanded: Record<string, boolean>;
  onToggle: (k: string) => void;
}) {
  const accounts = showOnlyFlagged
    ? cat.accounts.filter((a) => a.flagged)
    : cat.accounts;
  if (cat.accounts.length === 0) return null;
  const catMoM = momCell(cat.monthly, current, priorMonth);
  return (
    <>
      <tr className="border-t border-slate-300 bg-slate-100/70">
        <td className="px-2 py-1.5" />
        <td className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
          {cat.label}
        </td>
        {months.map((m) => (
          <td
            key={m}
            className={`px-3 py-1.5 text-right text-xs tabular-nums ${
              m === current ? "bg-slate-200/60" : ""
            }`}
          >
            {fmt(cat.monthly[m] ?? 0)}
          </td>
        ))}
        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-600">
          {catMoM.hasPrior ? formatPct(catMoM.pct) : "—"}
        </td>
        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-500">—</td>
        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-500">—</td>
      </tr>
      {accounts.map((a) => (
        <AccountRows
          key={a.accountNumber}
          account={a}
          months={months}
          current={current}
          priorMonth={priorMonth}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

function AccountRows({
  account,
  months,
  current,
  priorMonth,
  expanded,
  onToggle,
}: {
  account: AccountGroup;
  months: MonthKey[];
  current: MonthKey;
  priorMonth: MonthKey | undefined;
  expanded: Record<string, boolean>;
  onToggle: (k: string) => void;
}) {
  const accountKey = `acct:${account.accountNumber}`;
  const isOpen = expanded[accountKey] ?? false;
  const canExpand =
    (account.hasSubaccounts && account.subaccounts.length > 0) ||
    (!account.hasSubaccounts && account.customers.length > 0);
  const rowBg = account.flagged ? "bg-amber-50/60" : "";
  const mom = momCell(account.monthly, current, priorMonth);
  return (
    <>
      <tr
        className={`border-t border-slate-200 ${canExpand ? "cursor-pointer" : ""} ${rowBg} hover:bg-amber-50/80`}
        onClick={canExpand ? () => onToggle(accountKey) : undefined}
      >
        <td className="px-2 py-1.5 text-center text-slate-400">
          {canExpand ? (isOpen ? "▾" : "▸") : ""}
        </td>
        <td className="px-3 py-1.5">
          <span className="font-mono text-[11px] text-slate-500">
            {account.accountNumber}
          </span>{" "}
          <span className="text-slate-900">{account.accountName}</span>
        </td>
        {months.map((m) => (
          <td
            key={m}
            className={`px-3 py-1.5 text-right tabular-nums ${
              m === current ? "bg-slate-100" : ""
            }`}
          >
            {fmt(account.monthly[m] ?? 0)}
          </td>
        ))}
        <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
          {mom.hasPrior ? formatPct(mom.pct) : "—"}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
          {fmt(account.avgPrior)}
        </td>
        <td
          className={`px-3 py-1.5 text-right tabular-nums ${
            account.flagged
              ? "font-semibold text-amber-700"
              : Math.abs(account.variance) >= 0.01
                ? "text-slate-600"
                : "text-slate-400"
          }`}
        >
          {fmt(account.variance)}
          {account.flagged && (
            <span className="ml-1 text-[10px]">({formatPct(account.variancePct)})</span>
          )}
        </td>
      </tr>
      {isOpen && account.hasSubaccounts &&
        account.subaccounts.map((sub) => (
          <SubaccountRows
            key={`${account.accountNumber}::${sub.subaccount.code || "__NONE__"}`}
            accountNumber={account.accountNumber}
            sub={sub}
            months={months}
            current={current}
            priorMonth={priorMonth}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
      {isOpen && !account.hasSubaccounts &&
        account.customers.map((c) => (
          <CustomerRow
            key={`${account.accountNumber}::cust::${c.counterparty}`}
            row={c}
            months={months}
            current={current}
            priorMonth={priorMonth}
            indent={1}
          />
        ))}
    </>
  );
}

function SubaccountRows({
  accountNumber,
  sub,
  months,
  current,
  priorMonth,
  expanded,
  onToggle,
}: {
  accountNumber: string;
  sub: SubaccountRow;
  months: MonthKey[];
  current: MonthKey;
  priorMonth: MonthKey | undefined;
  expanded: Record<string, boolean>;
  onToggle: (k: string) => void;
}) {
  const subKey = `sub:${accountNumber}:${sub.subaccount.code || "__NONE__"}`;
  const isOpen = expanded[subKey] ?? false;
  const canExpand = sub.customers.length > 0;
  const rowBg = sub.flagged ? "bg-amber-50/40" : "bg-slate-50/60";
  const mom = momCell(sub.monthly, current, priorMonth);
  return (
    <>
      <tr
        className={`border-t border-slate-100 text-xs ${rowBg} ${
          canExpand ? "cursor-pointer" : ""
        } hover:bg-slate-100/70`}
        onClick={canExpand ? () => onToggle(subKey) : undefined}
      >
        <td className="px-2 py-1 text-center text-slate-400">
          {canExpand ? (isOpen ? "▾" : "▸") : ""}
        </td>
        <td className="px-3 py-1 pl-10 text-slate-700">
          {sub.subaccount.label}
        </td>
        {months.map((m) => (
          <td
            key={m}
            className={`px-3 py-1 text-right tabular-nums ${
              m === current ? "bg-slate-100" : ""
            }`}
          >
            {fmt(sub.monthly[m] ?? 0)}
          </td>
        ))}
        <td className="px-3 py-1 text-right tabular-nums text-slate-500">
          {mom.hasPrior ? formatPct(mom.pct) : "—"}
        </td>
        <td className="px-3 py-1 text-right tabular-nums text-slate-500">
          {fmt(sub.avgPrior)}
        </td>
        <td
          className={`px-3 py-1 text-right tabular-nums ${
            sub.flagged ? "font-medium text-amber-700" : "text-slate-500"
          }`}
        >
          {fmt(sub.variance)}
          {sub.flagged && (
            <span className="ml-1 text-[10px]">({formatPct(sub.variancePct)})</span>
          )}
        </td>
      </tr>
      {isOpen &&
        sub.customers.map((c) => (
          <CustomerRow
            key={`${accountNumber}::sub::${sub.subaccount.code}::${c.counterparty}`}
            row={c}
            months={months}
            current={current}
            priorMonth={priorMonth}
            indent={2}
          />
        ))}
    </>
  );
}

function CustomerRow({
  row,
  months,
  current,
  priorMonth,
  indent,
}: {
  row: CustomerRow;
  months: MonthKey[];
  current: MonthKey;
  priorMonth: MonthKey | undefined;
  indent: 1 | 2;
}) {
  const padLeft = indent === 2 ? "pl-16" : "pl-10";
  const bg = row.flagged ? "bg-amber-50/30" : "bg-white";
  const mom = momCell(row.monthly, current, priorMonth);
  return (
    <tr className={`border-t border-slate-100 text-[11px] ${bg}`}>
      <td className="px-2 py-1" />
      <td className={`px-3 py-1 ${padLeft} text-slate-600`}>{row.counterparty}</td>
      {months.map((m) => (
        <td
          key={m}
          className={`px-3 py-1 text-right tabular-nums ${
            m === current ? "bg-slate-50" : ""
          }`}
        >
          {fmt(row.monthly[m] ?? 0)}
        </td>
      ))}
      <td className="px-3 py-1 text-right tabular-nums text-slate-400">
        {mom.hasPrior ? formatPct(mom.pct) : "—"}
      </td>
      <td className="px-3 py-1 text-right tabular-nums text-slate-400">
        {fmt(row.avgPrior)}
      </td>
      <td
        className={`px-3 py-1 text-right tabular-nums ${
          row.flagged ? "font-medium text-amber-700" : "text-slate-400"
        }`}
      >
        {fmt(row.variance)}
      </td>
    </tr>
  );
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function formatPct(p: number): string {
  const n = Math.round(p * 100);
  return `${n >= 0 ? "+" : ""}${n}%`;
}
