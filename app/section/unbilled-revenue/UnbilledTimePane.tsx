"use client";

import { useEffect, useState } from "react";
import { fmt } from "@/lib/recon";

type ProjectCost = {
  billingMethod: string | null;
  billingAmount: number | null;
  budgetHours: number | null;
  estimatedHours: number | null;
  actualHours: number | null;
  estimatedTimeCost: number | null;
  estimatedTimeRevenue: number | null;
  percentComplete: number | null;
};

type Row = {
  rowId: string;
  category: "service-time" | "project-tm" | "project-fixed";
  label: string;
  company: string;
  hours: number;
  revenue: number;
  cost: number;
  entryCount: number;
  project: ProjectCost | null;
  pct: number;
};

type CategoryGroup = {
  category: Row["category"];
  label: string;
  rows: Row[];
  grossTotal: number;
  recognizedTotal: number;
  includedCount: number;
  totalCount: number;
};

type OkResponse = {
  ok: true;
  asOfDate: string;
  periodKey: string;
  categories: CategoryGroup[];
  grossTotal: number;
  recognizedTotal: number;
  lastSavedAt: string | null;
};

type ErrResponse = { ok: false; error: string; status?: number; body?: unknown };

type JournalEntry = {
  date: string; // YYYY-MM-DD, last day of period
  reverseDate: string; // YYYY-MM-DD, first day of next month
  memo: string;
  lines: Array<{
    account: string;
    accountName: string;
    debit: number;
    credit: number;
  }>;
  breakdown: Array<{ category: string; recognized: number }>;
};

type Props = { periodEnd: string };

export default function UnbilledTimePane({ periodEnd }: Props) {
  const [asOf, setAsOf] = useState(periodEnd || "");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<OkResponse | null>(null);
  const [err, setErr] = useState<ErrResponse | null>(null);
  // Local mutable copy of selections (rowId → pct) so we don't re-fetch on
  // every checkbox toggle. Persisted via "Save selections" button.
  const [localPct, setLocalPct] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    "service-time": true,
    "project-tm": true,
    "project-fixed": true,
  });
  // Internal time = work logged against Gravity Networks itself (not a
  // customer). Default-on: these hours don't produce external revenue and
  // would inflate the unbilled number if included.
  const [excludeInternal, setExcludeInternal] = useState(true);
  // Proposed journal entry — populated when the user clicks "Save & Generate JE".
  // Kept in state so the block persists while they review/copy before booking.
  const [journalEntry, setJournalEntry] = useState<JournalEntry | null>(null);
  // Editable debit/credit accounts for the JE (defaults from the doc):
  //   DR 105070 Unbilled Revenue, Current
  //   CR 405010 Non-Recurring Professional Services
  const [debitAccount, setDebitAccount] = useState("105070");
  const [debitName, setDebitName] = useState("Unbilled Revenue, Current");
  const [creditAccount, setCreditAccount] = useState("405010");
  const [creditName, setCreditName] = useState("Non-Recurring Professional Services");

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/unbilled-revenue?asOf=${encodeURIComponent(asOf)}`
      );
      const json = (await res.json()) as OkResponse | ErrResponse;
      if (!json.ok) {
        setErr(json);
        setResult(null);
      } else {
        setResult(json);
        const pctMap: Record<string, number> = {};
        for (const cat of json.categories) {
          for (const r of cat.rows) pctMap[r.rowId] = r.pct;
        }
        setLocalPct(pctMap);
      }
    } catch (e) {
      setErr({ ok: false, error: (e as Error).message });
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function save(): Promise<boolean> {
    if (!result) return false;
    setSaving(true);
    try {
      const res = await fetch("/api/unbilled-revenue/selections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodKey: result.periodKey,
          selections: Object.fromEntries(
            Object.entries(localPct).map(([k, v]) => [k, { pct: v }])
          ),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setResult((prev) => (prev ? { ...prev, lastSavedAt: json.savedAt } : prev));
        return true;
      } else {
        setErr({ ok: false, error: json.error ?? "Save failed" });
        return false;
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveAndGenerateJe() {
    const ok = await save();
    if (!ok || !result) return;
    // Totals and category breakdown come from the current view (respects
    // excludeInternal + per-row pct). This is the recognized amount the user
    // is about to book.
    const breakdown = categoriesForDisplay
      .map((c) => ({ category: c.label, recognized: round2(c.recognizedTotal) }))
      .filter((b) => b.recognized > 0);
    const recognized = round2(
      categoriesForDisplay.reduce((s, c) => s + c.recognizedTotal, 0)
    );
    if (recognized <= 0) {
      setErr({
        ok: false,
        error: "Nothing selected to recognize — check at least one row first.",
      });
      return;
    }
    const je: JournalEntry = {
      date: asOf,
      reverseDate: firstOfNextMonth(asOf),
      memo:
        `Unbilled revenue — CW open ticket/project time through ${asOf} ` +
        `not yet invoiced. Reverses on ${firstOfNextMonth(asOf)}.` +
        (excludeInternal ? " Internal time (Gravity Networks) excluded." : ""),
      lines: [
        {
          account: debitAccount,
          accountName: debitName,
          debit: recognized,
          credit: 0,
        },
        {
          account: creditAccount,
          accountName: creditName,
          debit: 0,
          credit: recognized,
        },
      ],
      breakdown,
    };
    setJournalEntry(je);
  }

  function toggleCheck(rowId: string) {
    setLocalPct((p) => ({
      ...p,
      [rowId]: (p[rowId] ?? 100) > 0 ? 0 : 100,
    }));
  }

  function setPct(rowId: string, v: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(v)));
    setLocalPct((p) => ({ ...p, [rowId]: clamped }));
  }

  const isInternalRow = (r: Row): boolean =>
    (r.company ?? "").toLowerCase().includes("gravity networks");

  const categoriesForDisplay = (result?.categories ?? []).map((cat) => {
    const visibleRows = excludeInternal
      ? cat.rows.filter((r) => !isInternalRow(r))
      : cat.rows;
    const grossTotal = visibleRows.reduce((s, r) => s + r.revenue, 0);
    const recognized = visibleRows.reduce(
      (s, r) => s + (r.revenue * (localPct[r.rowId] ?? r.pct)) / 100,
      0
    );
    const includedCount = visibleRows.filter(
      (r) => (localPct[r.rowId] ?? r.pct) > 0
    ).length;
    return {
      ...cat,
      rows: visibleRows,
      totalCount: visibleRows.length,
      grossTotal,
      recognizedTotal: recognized,
      includedCount,
    };
  });
  const grandRecognized = categoriesForDisplay.reduce(
    (s, c) => s + c.recognizedTotal,
    0
  );
  const grandGross = categoriesForDisplay.reduce((s, c) => s + c.grossTotal, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded border border-slate-200 bg-white px-4 py-3">
        <label className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            As of
          </div>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={loading || !asOf}
          className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !result}
          className="rounded border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save selections"}
        </button>
        {result?.lastSavedAt && (
          <span className="text-xs text-slate-500">
            Last saved {new Date(result.lastSavedAt).toLocaleString()}
          </span>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={excludeInternal}
            onChange={(e) => setExcludeInternal(e.target.checked)}
          />
          Exclude internal time (Gravity Networks)
        </label>
      </div>

      {err && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <div className="font-medium">Couldn&apos;t load unbilled time</div>
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
          <div className="grid grid-cols-4 gap-3">
            <Panel label="Gross unbilled" value={fmt(grandGross)} />
            <Panel
              label="Recognized (selected)"
              value={fmt(grandRecognized)}
              tone={grandRecognized > 0 ? "ok" : "neutral"}
            />
            <Panel label="Period" value={result.periodKey} />
            <Panel
              label="Rows"
              value={String(result.categories.reduce((s, c) => s + c.totalCount, 0))}
            />
          </div>

          {categoriesForDisplay.map((cat) => (
            <CategoryTable
              key={cat.category}
              cat={cat}
              localPct={localPct}
              expanded={expanded[cat.category] ?? true}
              onExpandToggle={() =>
                setExpanded((p) => ({ ...p, [cat.category]: !(p[cat.category] ?? true) }))
              }
              onToggleCheck={toggleCheck}
              onPctChange={setPct}
            />
          ))}

          <div className="flex flex-wrap items-end gap-4 rounded border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-600">
              <div className="font-medium uppercase tracking-wide text-slate-500">
                Journal entry accounts
              </div>
              <div className="mt-1 flex gap-4">
                <label className="flex items-center gap-2">
                  DR{" "}
                  <input
                    value={debitAccount}
                    onChange={(e) => setDebitAccount(e.target.value)}
                    className="w-20 rounded border border-slate-300 px-2 py-0.5 font-mono text-xs"
                  />
                  <input
                    value={debitName}
                    onChange={(e) => setDebitName(e.target.value)}
                    className="w-56 rounded border border-slate-300 px-2 py-0.5 text-xs"
                  />
                </label>
                <label className="flex items-center gap-2">
                  CR{" "}
                  <input
                    value={creditAccount}
                    onChange={(e) => setCreditAccount(e.target.value)}
                    className="w-20 rounded border border-slate-300 px-2 py-0.5 font-mono text-xs"
                  />
                  <input
                    value={creditName}
                    onChange={(e) => setCreditName(e.target.value)}
                    className="w-72 rounded border border-slate-300 px-2 py-0.5 text-xs"
                  />
                </label>
              </div>
            </div>
            <button
              type="button"
              onClick={saveAndGenerateJe}
              disabled={saving || grandRecognized <= 0}
              className="ml-auto rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save & Generate JE"}
            </button>
          </div>

          {journalEntry && (
            <JournalEntryBlock je={journalEntry} onDismiss={() => setJournalEntry(null)} />
          )}
        </>
      )}
    </div>
  );
}

function JournalEntryBlock({
  je,
  onDismiss,
}: {
  je: JournalEntry;
  onDismiss: () => void;
}) {
  const debitTotal = je.lines.reduce((s, l) => s + l.debit, 0);
  const creditTotal = je.lines.reduce((s, l) => s + l.credit, 0);
  const text =
    `JOURNAL ENTRY — REVERSING\n` +
    `Date: ${je.date}   Reverses: ${je.reverseDate}\n` +
    `Memo: ${je.memo}\n\n` +
    je.lines
      .map(
        (l) =>
          `${l.account.padEnd(8)} ${l.accountName.padEnd(44)}` +
          `  Dr ${l.debit ? fmt(l.debit) : ""}`.padEnd(20) +
          `  Cr ${l.credit ? fmt(l.credit) : ""}`
      )
      .join("\n");
  return (
    <div className="rounded border border-emerald-300 bg-emerald-50 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
            Adjusting Journal Entry — reversing
          </div>
          <div className="mt-1 text-sm text-slate-800">
            Date <span className="font-mono">{je.date}</span> · Reverses{" "}
            <span className="font-mono">{je.reverseDate}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(text)}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Dismiss
          </button>
        </div>
      </div>
      <div className="mt-3 rounded border border-emerald-200 bg-white px-3 py-2 text-xs text-slate-700">
        <span className="font-medium text-slate-900">Memo:</span> {je.memo}
      </div>
      <table className="mt-3 w-full text-sm">
        <thead className="text-slate-600">
          <tr>
            <th className="px-2 py-1 text-left font-medium w-[80px]">Account</th>
            <th className="px-2 py-1 text-left font-medium">Name</th>
            <th className="px-2 py-1 text-right font-medium w-[130px]">Debit</th>
            <th className="px-2 py-1 text-right font-medium w-[130px]">Credit</th>
          </tr>
        </thead>
        <tbody>
          {je.lines.map((l, i) => (
            <tr key={i} className="border-t border-emerald-100">
              <td className="px-2 py-1 font-mono text-xs">{l.account}</td>
              <td className="px-2 py-1">{l.accountName}</td>
              <td className="px-2 py-1 text-right tabular-nums">
                {l.debit ? fmt(l.debit) : ""}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                {l.credit ? fmt(l.credit) : ""}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-700 bg-emerald-100 font-semibold">
            <td className="px-2 py-1" colSpan={2}>
              Totals
            </td>
            <td className="px-2 py-1 text-right tabular-nums">{fmt(debitTotal)}</td>
            <td className="px-2 py-1 text-right tabular-nums">{fmt(creditTotal)}</td>
          </tr>
        </tbody>
      </table>
      {je.breakdown.length > 0 && (
        <div className="mt-3 text-xs text-slate-600">
          <div className="font-medium uppercase tracking-wide text-slate-500">
            Breakdown by category
          </div>
          <ul className="mt-1 space-y-0.5">
            {je.breakdown.map((b) => (
              <li key={b.category} className="flex justify-between">
                <span>{b.category}</span>
                <span className="tabular-nums">{fmt(b.recognized)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {Math.abs(debitTotal - creditTotal) >= 0.01 && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-900">
          JE does not balance — Dr ({fmt(debitTotal)}) ≠ Cr ({fmt(creditTotal)}).
        </div>
      )}
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function firstOfNextMonth(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  // new Date(y, m, 1) — m is 1-indexed from the string but 0-indexed in Date,
  // so Date(y, m, 1) gives us the first of the following calendar month.
  const next = new Date(Date.UTC(y, m, 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, "0");
  return `${ny}-${nm}-01`;
}

function CategoryTable({
  cat,
  localPct,
  expanded,
  onExpandToggle,
  onToggleCheck,
  onPctChange,
}: {
  cat: CategoryGroup;
  localPct: Record<string, number>;
  expanded: boolean;
  onExpandToggle: () => void;
  onToggleCheck: (rowId: string) => void;
  onPctChange: (rowId: string, v: number) => void;
}) {
  const showProjectCols = cat.category !== "service-time";
  return (
    <div className="rounded border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onExpandToggle}
        className="flex w-full items-center justify-between bg-slate-50 px-4 py-2 text-left hover:bg-slate-100"
      >
        <div className="flex items-center gap-3">
          <span className="text-slate-400">{expanded ? "▾" : "▸"}</span>
          <span className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            {cat.label}
          </span>
          <span className="text-xs text-slate-500">
            {cat.includedCount} of {cat.totalCount} included
          </span>
        </div>
        <div className="flex items-baseline gap-4 text-sm tabular-nums">
          <span className="text-slate-500">
            Gross <span className="text-slate-900">{fmt(cat.grossTotal)}</span>
          </span>
          <span className="text-slate-500">
            Recognized{" "}
            <span className="font-semibold text-slate-900">
              {fmt(cat.recognizedTotal)}
            </span>
          </span>
        </div>
      </button>
      {expanded && cat.rows.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-white text-slate-600">
            <tr className="border-t border-slate-200">
              <th className="w-10 px-2 py-2" />
              <th className="px-3 py-2 text-left font-medium">
                {cat.category === "service-time" ? "Ticket / Company" : "Project / Company"}
              </th>
              <th className="px-3 py-2 text-right font-medium">Hours</th>
              <th className="px-3 py-2 text-right font-medium">Revenue</th>
              {showProjectCols && (
                <>
                  <th className="px-3 py-2 text-right font-medium">Cost (WIP)</th>
                  <th className="px-3 py-2 text-right font-medium" title="Fixed-fee contract value">
                    Contract
                  </th>
                </>
              )}
              <th className="px-3 py-2 text-right font-medium w-[110px]">% Recog.</th>
              <th className="px-3 py-2 text-right font-medium">Recognized</th>
            </tr>
          </thead>
          <tbody>
            {cat.rows.map((r) => {
              const pct = localPct[r.rowId] ?? r.pct;
              const included = pct > 0;
              const recognized = (r.revenue * pct) / 100;
              const overBudget =
                cat.category === "project-fixed" &&
                r.project?.billingAmount != null &&
                r.cost > r.project.billingAmount;
              return (
                <tr
                  key={r.rowId}
                  className={`border-t border-slate-100 ${
                    overBudget ? "bg-red-50/40" : included ? "" : "bg-slate-50/60"
                  }`}
                >
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={() => onToggleCheck(r.rowId)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="text-slate-900">{r.label}</div>
                    {r.company && (
                      <div className="text-xs text-slate-500">{r.company}</div>
                    )}
                    {overBudget && (
                      <div className="mt-0.5 text-xs font-medium text-red-700">
                        Cost exceeds fixed-fee contract — review before recognizing
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.hours.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.revenue)}</td>
                  {showProjectCols && (
                    <>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                        {fmt(r.cost)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                        {r.project?.billingAmount != null
                          ? fmt(r.project.billingAmount)
                          : "—"}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-1.5 text-right">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={pct}
                      onChange={(e) => onPctChange(r.rowId, Number(e.target.value))}
                      className="w-20 rounded border border-slate-300 px-2 py-0.5 text-right font-mono text-xs"
                    />
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      included ? "font-medium text-slate-900" : "text-slate-400"
                    }`}
                  >
                    {included ? fmt(recognized) : "—"}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <td />
              <td className="px-3 py-1.5">{cat.label} total</td>
              <td />
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(cat.grossTotal)}</td>
              {showProjectCols && (
                <>
                  <td />
                  <td />
                </>
              )}
              <td />
              <td className="px-3 py-1.5 text-right tabular-nums">
                {fmt(cat.recognizedTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {expanded && cat.rows.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-slate-500">
          No unbilled {cat.label.toLowerCase()} as of this date.
        </div>
      )}
    </div>
  );
}

function Panel({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : "text-slate-900";
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-base tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
