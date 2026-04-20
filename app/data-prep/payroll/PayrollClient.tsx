"use client";

import { useEffect, useRef, useState } from "react";
import type { Dept, Bucket } from "./types";
import {
  parseGustoCsv,
  matchEmployees,
  buildPayrollJe,
  jeToCsv,
  BUCKET_LABELS as JE_BUCKET_LABELS,
  BUCKET_ORDER as JE_BUCKET_ORDER,
  type GustoEmployee,
  type EmployeeMatch,
  type JournalEntry,
  type PctByBucket,
} from "./gustoJe";

const DEPT_LABELS: Record<Dept, string> = {
  professional: "Professional Services",
  managed: "Managed Services",
  admin: "Admin",
  sales: "Sales",
};

const DEPT_ORDER: Dept[] = ["professional", "managed", "admin", "sales"];

const BUCKET_LABELS: Record<Bucket, string> = {
  managed: "Managed Services",
  recurring: "Re-occurring",
  nonRecurring: "Non-recurring",
  voip: "VOIP Hard COGS",
  sales: "Sales",
  admin: "Admin",
};

const BUCKET_ORDER: Bucket[] = [
  "managed",
  "recurring",
  "nonRecurring",
  "voip",
  "sales",
  "admin",
];

type MemberRow = {
  memberId: number;
  identifier: string;
  name: string;
  defaultDept: Dept;
  totalTrackedHours: number;
  rawHoursByBucket: Record<Bucket, number>;
  entryCount: number;
};

type OkResponse = {
  ok: true;
  period: {
    year: number;
    month: number;
    half: "first" | "second";
    startDate: string;
    endDate: string;
    label: string;
    weeks: number;
  };
  members: MemberRow[];
  companies: Array<{ name: string; hours: number }>;
  excludedCompanies: string[];
};

type ErrResponse = { ok: false; error: string; status?: number; body?: unknown };

type Props = {
  defaultYear: number;
  defaultMonth: number;
  defaultHalf: "first" | "second";
};

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Built-in defaults — internal companies we always want to start excluded.
// User can remove any or add more via the UI.
const DEFAULT_EXCLUDED = ["Gravity Networks LLC"];

export default function PayrollClient({ defaultYear, defaultMonth, defaultHalf }: Props) {
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [half, setHalf] = useState<"first" | "second">(defaultHalf);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<ErrResponse | null>(null);
  const [result, setResult] = useState<OkResponse | null>(null);
  // Client-only state — dept choices and excluded companies don't persist
  // across reloads.
  const [deptOverrides, setDeptOverrides] = useState<Record<number, Dept>>({});
  const [excludedCompanies, setExcludedCompanies] = useState<string[]>(DEFAULT_EXCLUDED);
  const [addCompanyPick, setAddCompanyPick] = useState<string>("");
  // Gusto upload + generated JE
  const gustoFileRef = useRef<HTMLInputElement>(null);
  const [gustoEmps, setGustoEmps] = useState<GustoEmployee[] | null>(null);
  const [gustoTotals, setGustoTotals] = useState<GustoEmployee | null>(null);
  const [gustoMatches, setGustoMatches] = useState<EmployeeMatch[]>([]);
  const [gustoFileName, setGustoFileName] = useState<string>("");
  const [gustoParseError, setGustoParseError] = useState<string | null>(null);
  const [je, setJe] = useState<JournalEntry | null>(null);
  // When true for a member, their payroll bypasses the percentage split and
  // the entire paycheck goes to their selected dept's bucket. Used for
  // people whose CW time doesn't reflect their real role (e.g. owners who
  // track little time, new hires, contractors mistakenly in Gusto).
  const [excludedFromSplit, setExcludedFromSplit] = useState<Record<number, boolean>>({});
  // Dept override for Gusto employees with no CW match (Sales/Admin folks
  // who aren't in CW time entries). Keyed by the Gusto "Last, First" name.
  // Defaults to admin in the JE builder if missing.
  const [unmatchedDepts, setUnmatchedDepts] = useState<Record<string, Dept>>({});

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          half,
          excludeCompanies: excludedCompanies,
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

  function setDept(memberId: number, d: Dept) {
    setDeptOverrides((p) => ({ ...p, [memberId]: d }));
  }

  function addExcluded(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (excludedCompanies.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return;
    setExcludedCompanies((p) => [...p, trimmed]);
  }

  function removeExcluded(name: string) {
    setExcludedCompanies((p) => p.filter((c) => c !== name));
  }

  // --- Gusto CSV handlers ---
  async function handleGustoUpload(file: File) {
    setGustoParseError(null);
    setJe(null);
    try {
      const text = await file.text();
      const { employees, totals } = parseGustoCsv(text);
      if (employees.length === 0) {
        setGustoParseError(
          "Couldn't find any employee rows in the CSV. Expected the Gusto Payroll Journal Report format with a 'Last Name,First Name,...' header row."
        );
        return;
      }
      setGustoEmps(employees);
      setGustoTotals(totals);
      setGustoFileName(file.name);
      // Match against the members we already pulled from CW.
      const members = (result?.members ?? []).map((m) => ({
        memberId: m.memberId,
        name: m.name,
        identifier: m.identifier,
      }));
      const matches = matchEmployees(employees, members);
      setGustoMatches(matches);
      // Seed unmatched-dept overrides with "admin" so the UI dropdowns have a
      // sensible starting value. User can flip individuals before generating.
      const seed: Record<string, Dept> = {};
      for (const m of matches) {
        if (!m.cwMember) seed[m.gusto.gustoName] = "admin";
      }
      setUnmatchedDepts(seed);
    } catch (e) {
      setGustoParseError((e as Error).message);
    }
  }

  function setUnmatchedDept(gustoName: string, d: Dept) {
    setUnmatchedDepts((p) => ({ ...p, [gustoName]: d }));
  }

  function generateJe() {
    if (gustoEmps === null) return;
    // Build percentage map from the already-enriched members (post-override).
    // For members flagged as excluded-from-split, we deliberately OMIT their
    // percentages — the JE builder's dept-based fallback then routes 100% of
    // their paycheck to their selected dept's bucket.
    const pctByMemberId: Record<number, PctByBucket> = {};
    const deptByMemberId: Record<number, Dept> = {};
    for (const em of enrichedMembers) {
      deptByMemberId[em.memberId] = em.dept;
      if (!excludedFromSplit[em.memberId]) {
        pctByMemberId[em.memberId] = em.pct;
      }
    }
    const built = buildPayrollJe(
      gustoMatches,
      pctByMemberId,
      deptByMemberId,
      unmatchedDepts,
      gustoTotals
    );
    setJe(built);
  }

  function toggleExcludeFromSplit(memberId: number) {
    setExcludedFromSplit((p) => ({ ...p, [memberId]: !p[memberId] }));
  }

  function downloadJeCsv() {
    if (!je) return;
    const label = result ? result.period.label : gustoFileName || "payroll";
    const csv = jeToCsv(je, label);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-je-${label.replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyToAccruedPayroll() {
    if (!je || !result) return;
    // Snapshot shape mirrors what section/accrued-payroll/AccruedPayrollClient
    // expects. Keeping the full summaryRows + bucketRows so the downstream
    // page can render both the flat DR/CR view and the bucket breakdown
    // without recomputing.
    const snapshot = {
      periodLabel: result.period.label,
      periodEnd: result.period.endDate,
      generatedAt: new Date().toISOString(),
      debitTotal: je.debitTotal,
      creditTotal: je.creditTotal,
      bucketRows: je.bucketRows,
      summaryRows: je.summaryRows,
    };
    try {
      localStorage.setItem("accruedPayrollSnapshot", JSON.stringify(snapshot));
      window.location.href = "/section/accrued-payroll";
    } catch (e) {
      alert(`Failed to save snapshot: ${(e as Error).message}`);
    }
  }

  // Per-member derivation — baseline, Sales/Admin remainder, and percentages
  // happen here so changing the dept dropdown updates the percentages
  // instantly without needing to re-fetch from the server.
  const weeks = result?.period.weeks ?? 2;
  const enrichedMembers = result
    ? result.members.map((m) => {
        const dept = deptOverrides[m.memberId] ?? m.defaultDept;
        const useFixedBaseline = dept === "sales" || dept === "admin";
        const baseline = useFixedBaseline ? 40 * weeks : m.totalTrackedHours;
        const hours = { ...m.rawHoursByBucket };
        const assigned =
          hours.managed + hours.recurring + hours.nonRecurring + hours.voip;
        if (dept === "sales") {
          hours.sales += Math.max(0, baseline - assigned);
        } else if (dept === "admin") {
          hours.admin += Math.max(0, baseline - assigned);
        }
        const pct: Record<Bucket, number> = {
          managed: 0,
          recurring: 0,
          nonRecurring: 0,
          voip: 0,
          sales: 0,
          admin: 0,
        };
        if (baseline > 0) {
          for (const b of BUCKET_ORDER) {
            pct[b] = Math.round((hours[b] / baseline) * 1000) / 10;
          }
        }
        return { ...m, dept, baseline, hours, pct };
      })
    : [];

  const totalsByBucket: Record<Bucket, number> = {
    managed: 0,
    recurring: 0,
    nonRecurring: 0,
    voip: 0,
    sales: 0,
    admin: 0,
  };
  for (const em of enrichedMembers) {
    for (const b of BUCKET_ORDER) totalsByBucket[b] += em.hours[b];
  }
  for (const b of BUCKET_ORDER) totalsByBucket[b] = Math.round(totalsByBucket[b] * 10) / 10;

  const availableToAdd =
    result?.companies
      .map((c) => c.name)
      .filter((n) => !excludedCompanies.some((e) => e.toLowerCase() === n.toLowerCase())) ??
    [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded border border-slate-200 bg-white px-4 py-3">
        <label className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Year
          </div>
          <input
            type="number"
            value={year}
            min={2000}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value))}
            className="mt-1 w-24 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
        <label className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Month
          </div>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {MONTH_LABELS.map((lbl, i) => (
              <option key={lbl} value={i + 1}>
                {lbl}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Half
          </div>
          <select
            value={half}
            onChange={(e) => setHalf(e.target.value as "first" | "second")}
            className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="first">1st (1–15)</option>
            <option value="second">2nd (16–end)</option>
          </select>
        </label>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Running…" : "Run allocation"}
        </button>
        {result && (
          <span className="ml-auto text-xs text-slate-500">
            {result.period.label} · {result.period.startDate} to {result.period.endDate}
          </span>
        )}
      </div>

      <div className="rounded border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Exclude companies
          </span>
          {excludedCompanies.length === 0 && (
            <span className="text-xs text-slate-400">(none)</span>
          )}
          {excludedCompanies.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
            >
              {c}
              <button
                type="button"
                onClick={() => removeExcluded(c)}
                className="text-slate-400 hover:text-slate-900"
                aria-label={`Remove ${c}`}
                title="Remove"
              >
                ×
              </button>
            </span>
          ))}
          {availableToAdd.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <select
                value={addCompanyPick}
                onChange={(e) => setAddCompanyPick(e.target.value)}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs"
              >
                <option value="">+ Add company…</option>
                {availableToAdd.slice(0, 200).map((c) => {
                  const hrs = result?.companies.find((x) => x.name === c)?.hours ?? 0;
                  return (
                    <option key={c} value={c}>
                      {c} ({hrs.toFixed(1)}h)
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (addCompanyPick) {
                    addExcluded(addCompanyPick);
                    setAddCompanyPick("");
                  }
                }}
                disabled={!addCompanyPick}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          )}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          Changes to the exclude list take effect on the next <span className="font-semibold">Run allocation</span>.
        </div>
      </div>

      {err && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <div className="font-medium">Allocation failed</div>
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
          <div className="grid grid-cols-6 gap-2">
            {BUCKET_ORDER.map((b) => (
              <div key={b} className="rounded border border-slate-200 bg-white px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {BUCKET_LABELS[b]}
                </div>
                <div className="mt-0.5 font-mono text-base tabular-nums text-slate-900">
                  {totalsByBucket[b].toFixed(1)} hrs
                </div>
              </div>
            ))}
          </div>

          <div className="rounded border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Member</th>
                  <th className="px-3 py-2 text-left font-medium w-[180px]">Department</th>
                  <th className="px-2 py-2 text-center font-medium w-[90px]" title="When checked, this member's entire paycheck posts 100% to their selected department's bucket — skipping the percentage split below.">
                    Exclude from split
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Tracked</th>
                  <th className="px-3 py-2 text-right font-medium">Baseline</th>
                  {BUCKET_ORDER.map((b) => (
                    <th key={b} className="px-3 py-2 text-right font-medium">
                      {BUCKET_LABELS[b]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {enrichedMembers.length === 0 && (
                  <tr>
                    <td
                      colSpan={5 + BUCKET_ORDER.length}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      No time entries in this pay period (after exclusions).
                    </td>
                  </tr>
                )}
                {enrichedMembers.map((m) => (
                  <tr key={m.memberId} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">
                      <div className="text-slate-900">{m.name}</div>
                      <div className="font-mono text-[10px] text-slate-500">
                        {m.identifier}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        value={m.dept}
                        onChange={(e) => setDept(m.memberId, e.target.value as Dept)}
                        className="w-full rounded border border-slate-300 px-2 py-0.5 text-xs"
                      >
                        {DEPT_ORDER.map((d) => (
                          <option key={d} value={d}>
                            {DEPT_LABELS[d]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={!!excludedFromSplit[m.memberId]}
                        onChange={() => toggleExcludeFromSplit(m.memberId)}
                        aria-label={`Exclude ${m.name} from split`}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                      {m.totalTrackedHours.toFixed(1)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                      {m.baseline.toFixed(1)}
                    </td>
                    {BUCKET_ORDER.map((b) => {
                      const pct = m.pct[b];
                      const hrs = m.hours[b];
                      const dim = pct === 0;
                      return (
                        <td
                          key={b}
                          className={`px-3 py-1.5 text-right tabular-nums ${
                            dim ? "text-slate-300" : "text-slate-900"
                          }`}
                          title={`${hrs.toFixed(2)} hrs`}
                        >
                          {pct.toFixed(1)}%
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {enrichedMembers.length > 0 && (
                  <tr className="border-t-2 border-slate-700 bg-slate-50 font-semibold">
                    <td className="px-3 py-2" colSpan={5}>
                      Total hours
                    </td>
                    {BUCKET_ORDER.map((b) => (
                      <td key={b} className="px-3 py-2 text-right tabular-nums">
                        {totalsByBucket[b].toFixed(1)}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <GustoJeSection
            fileInputRef={gustoFileRef}
            gustoEmps={gustoEmps}
            gustoFileName={gustoFileName}
            gustoMatches={gustoMatches}
            gustoParseError={gustoParseError}
            je={je}
            onUpload={handleGustoUpload}
            onGenerate={generateJe}
            onDownload={downloadJeCsv}
            onCopyToAccruedPayroll={copyToAccruedPayroll}
            periodLabel={result?.period.label ?? ""}
            unmatchedDepts={unmatchedDepts}
            onUnmatchedDeptChange={setUnmatchedDept}
          />
        </>
      )}
    </div>
  );
}

function GustoJeSection({
  fileInputRef,
  gustoEmps,
  gustoFileName,
  gustoMatches,
  gustoParseError,
  je,
  onUpload,
  onGenerate,
  onDownload,
  onCopyToAccruedPayroll,
  periodLabel,
  unmatchedDepts,
  onUnmatchedDeptChange,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  gustoEmps: GustoEmployee[] | null;
  gustoFileName: string;
  gustoMatches: EmployeeMatch[];
  gustoParseError: string | null;
  je: JournalEntry | null;
  onUpload: (file: File) => void;
  onGenerate: () => void;
  onDownload: () => void;
  onCopyToAccruedPayroll: () => void;
  periodLabel: string;
  unmatchedDepts: Record<string, Dept>;
  onUnmatchedDeptChange: (gustoName: string, d: Dept) => void;
}) {
  const matchedCount = gustoMatches.filter((m) => m.cwMember).length;
  const unmatched = gustoMatches.filter((m) => !m.cwMember);

  return (
    <div className="mt-6 space-y-4">
      <div className="border-t border-slate-300 pt-4">
        <h2 className="text-lg font-semibold text-slate-900">Payroll Journal Entry</h2>
        <p className="text-xs text-slate-600">
          Upload the Gusto Payroll Journal Report CSV and a drafted JE will be built using
          the allocation percentages above. Gross wages + employer taxes split across
          COGS/SG&amp;A buckets per employee; everything else posts to the standard SG&amp;A
          accounts.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white px-4 py-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          {gustoFileName ? "Replace Gusto CSV" : "Upload Gusto CSV"}
        </button>
        {gustoFileName && (
          <span className="text-xs text-slate-600">
            <span className="font-mono">{gustoFileName}</span> ·
            <span className="ml-1">{gustoEmps?.length ?? 0} employees</span> ·
            <span className="ml-1 text-emerald-700">{matchedCount} matched</span>
            {unmatched.length > 0 && (
              <>
                {" · "}
                <span className="text-amber-700">{unmatched.length} unmatched</span>
              </>
            )}
          </span>
        )}
        <button
          type="button"
          onClick={onGenerate}
          disabled={!gustoEmps}
          className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Generate JE
        </button>
        {je && (
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onCopyToAccruedPayroll}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Copy to Accrued Payroll Report
            </button>
            <button
              type="button"
              onClick={onDownload}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Download CSV
            </button>
          </div>
        )}
      </div>

      {gustoParseError && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <div className="font-medium">Couldn&apos;t parse Gusto CSV</div>
          <div className="mt-1 font-mono text-xs">{gustoParseError}</div>
        </div>
      )}

      {unmatched.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-sm font-semibold text-amber-900">
            Unmatched employees — pick a department
          </div>
          <div className="mt-1 text-xs text-amber-900">
            These Gusto employees don&apos;t have matching CW time entries in this
            period. Their entire paycheck will post 100% to the bucket for the
            department selected below (default: Admin). Sales / Admin posts to
            SG&amp;A wages; Professional / Managed Services posts to the
            corresponding COGS wage account.
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unmatched.map((m) => {
              const name = m.gusto.gustoName;
              const dept = unmatchedDepts[name] ?? "admin";
              return (
                <label
                  key={name}
                  className="flex items-center justify-between gap-2 rounded border border-amber-200 bg-white px-2 py-1 text-xs"
                >
                  <span className="truncate text-slate-900" title={name}>
                    {name}
                  </span>
                  <select
                    value={dept}
                    onChange={(e) =>
                      onUnmatchedDeptChange(name, e.target.value as Dept)
                    }
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs"
                  >
                    {DEPT_ORDER.map((d) => (
                      <option key={d} value={d}>
                        {DEPT_LABELS[d]}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {je && (
        <div className="rounded border border-slate-200 bg-white overflow-x-auto">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
            Drafted JE — {periodLabel}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-white text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Line item</th>
                {JE_BUCKET_ORDER.map((b) => (
                  <th key={b} className="px-3 py-2 text-right font-medium">
                    {JE_BUCKET_LABELS[b]}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {je.bucketRows.map((row) => (
                <tr key={row.lineItem} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-900">{row.lineItem}</td>
                  {JE_BUCKET_ORDER.map((b) => {
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
                        <div>${amt.toFixed(2)}</div>
                        <div className="font-mono text-[10px] text-slate-500">{acct}</div>
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                    ${row.total.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Full journal entry (DR/CR)
            </div>
            <table className="w-full text-sm">
              <thead className="bg-white text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium w-[90px]">Account</th>
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-left font-medium">Line</th>
                  <th className="px-3 py-2 text-right font-medium w-[120px]">Debit</th>
                  <th className="px-3 py-2 text-right font-medium w-[120px]">Credit</th>
                </tr>
              </thead>
              <tbody>
                {je.summaryRows.map((r, i) => (
                  <tr key={`${r.account}-${i}`} className="border-t border-slate-100">
                    <td className="px-3 py-1 font-mono text-xs">{r.account}</td>
                    <td className="px-3 py-1 text-slate-700">{r.accountName}</td>
                    <td className="px-3 py-1 text-slate-500 text-xs">{r.lineItem}</td>
                    <td className="px-3 py-1 text-right tabular-nums">
                      {r.debit ? `$${r.debit.toFixed(2)}` : ""}
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums">
                      {r.credit ? `$${r.credit.toFixed(2)}` : ""}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-700 bg-slate-50 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>
                    Totals
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    ${je.debitTotal.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    ${je.creditTotal.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
            {Math.abs(je.debitTotal - je.creditTotal) >= 0.01 && (
              <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Debits (${je.debitTotal.toFixed(2)}) ≠ Credits (${je.creditTotal.toFixed(2)}). Difference: ${(je.debitTotal - je.creditTotal).toFixed(2)}. The Gusto totals include employee deductions that net inside the CRs — review lines before posting.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
