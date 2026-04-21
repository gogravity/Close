"use client";

import { Fragment, useState } from "react";
import { fmt } from "@/lib/recon";

type Category =
  | "new_acquisition_beginning"
  | "fx_adjustment"
  | "one_time_adj"
  | "recurring_licenses"
  | "new_client"
  | "price_increase"
  | "upsell"
  | "price_decrease"
  | "downsell"
  | "churn"
  | "flat";

const CATEGORY_META: Record<Category, { label: string; description: string; sign: "positive" | "negative" | "neutral" }> = {
  new_acquisition_beginning: {
    label: "New Acquisition Beginning MRR",
    description: "Opening balance MRR for new acquisitions only.",
    sign: "positive",
  },
  fx_adjustment: {
    label: "MRR Adj — FX Rate Change",
    description: "Only used in conjunction with opco's who have foreign currency exchanges.",
    sign: "neutral",
  },
  one_time_adj: {
    label: "One-Time MRR Adj",
    description:
      "Only to be used to account for a monthly unusual transaction that does not fit into one of the standard groupings (e.g. accidental double billing or credits).",
    sign: "neutral",
  },
  recurring_licenses: {
    label: "New & Existing Re-occurring Licenses",
    description:
      "Only used if there are materially large annual licenses previously included in MRR and not reclassified into the new Re-occurring revenue line (seek Lyra approval).",
    sign: "positive",
  },
  new_client: {
    label: "New MRR, New Clients",
    description: "Completely new logo, new MRR additions only.",
    sign: "positive",
  },
  price_increase: {
    label: "New MRR, Price Increase Existing Clients",
    description:
      "Price increases to existing clients for any reason (annual review, vendor cost increases, etc.).",
    sign: "positive",
  },
  upsell: {
    label: "New MRR, Upsell Existing Clients",
    description:
      "Existing clients upsold new services, or existing services where quantity sold increases.",
    sign: "positive",
  },
  price_decrease: {
    label: "Lost MRR, Price Decrease Existing Clients",
    description:
      "Price decreases to existing clients for any reason (annual review, client negotiations, etc.).",
    sign: "negative",
  },
  downsell: {
    label: "Lost MRR, Downsell Existing Clients",
    description:
      "Existing clients terminating some services but remaining for others, or where quantity sold decreases.",
    sign: "negative",
  },
  churn: {
    label: "Lost MRR, Client Churn",
    description:
      "Fully churning clients terminating all services. If churn happens over several months, include the monthly churned amount here until gone.",
    sign: "negative",
  },
  flat: {
    label: "Flat",
    description: "No net MRR change.",
    sign: "neutral",
  },
};

// Ordered for the bridge table display
const BRIDGE_ORDER: Category[] = [
  "new_acquisition_beginning",
  "fx_adjustment",
  "one_time_adj",
  "recurring_licenses",
  "new_client",
  "price_increase",
  "upsell",
  "price_decrease",
  "downsell",
  "churn",
];

type ProductChange = {
  productId: string;
  subcategory: string;
  priorQuantity: number;
  currentQuantity: number;
  priorUnitPrice: number;
  currentUnitPrice: number;
  priorTotal: number;
  currentTotal: number;
  change: number;
  category: "new_product" | "removed_product" | "price_increase" | "upsell" | "downsell" | "flat";
};

type BridgeLine = {
  rowId: string;
  company: string;
  agreement: string;
  agreementId: number | null;
  priorMrr: number;
  currentMrr: number;
  change: number;
  category: Category;
  products?: ProductChange[];
  priceIncreaseAmount?: number;
};

type BridgeCustomer = {
  customerId: string;
  customerName: string;
  priorMrr: number;
  currentMrr: number;
  change: number;
  category: Category;
  agreements: BridgeLine[];
};

type DisplayUnit =
  | { kind: "customer"; id: string; customer: BridgeCustomer; category: Category }
  | { kind: "agreement"; id: string; customerName: string; agreement: BridgeLine; category: Category };

type SignedDeal = {
  dealName: string;
  company: string;
  mrr: number;
  closeDate: string;
};

type OkResponse = {
  ok: true;
  priorPeriod: string;
  currentPeriod: string;
  priorStart: string;
  priorEnd: string;
  currentStart: string;
  currentEnd: string;
  beginningMrr: number;
  endingMrr: number;
  endingArr: number;
  newMrrNewClients: number;
  newMrrPriceIncrease: number;
  newMrrUpsell: number;
  lostMrrDownsell: number;
  lostMrrChurn: number;
  netChange: number;
  mrrGrowthPct: number;
  netMrrRetentionPct: number;
  grossMrrRetentionPct: number;
  grossMrrChurn: number;
  beginningSignedNotOnboarded: number;
  newSignedNotOnboarded: number;
  lessOnboarded: number;
  endingSignedNotOnboarded: number;
  hubspotSkipped: boolean;
  lines: BridgeLine[];
  customers: BridgeCustomer[];
  signedDeals: SignedDeal[];
};

type ErrResponse = { ok: false; error: string; status?: number; body?: unknown };

type Props = {
  defaultPriorMonth: string;    // YYYY-MM
  defaultCurrentMonth: string;  // YYYY-MM
  hubspotConfigured: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Returns the first and last day of a YYYY-MM month as YYYY-MM-DD strings. */
function monthBounds(month: string): { start: string; end: string } {
  const [year, m] = month.split("-").map(Number);
  const start = `${year}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const end = `${year}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export default function MrrBridgeClient({ defaultPriorMonth, defaultCurrentMonth, hubspotConfigured }: Props) {
  const [priorMonth, setPriorMonth] = useState(defaultPriorMonth);
  const [currentMonth, setCurrentMonth] = useState(defaultCurrentMonth);
  const [priorSigned, setPriorSigned] = useState(0);
  const [skipHubspot, setSkipHubspot] = useState(!hubspotConfigured);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OkResponse | null>(null);
  const [err, setErr] = useState<ErrResponse | null>(null);
  const [filter, setFilter] = useState<"all" | Category>("all");
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, Category>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [uncombined, setUncombined] = useState<Record<string, boolean>>({});
  const [showLegend, setShowLegend] = useState(false);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      const prior = monthBounds(priorMonth);
      const current = monthBounds(currentMonth);
      const res = await fetch("/api/mrr-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priorStart: prior.start, priorEnd: prior.end,
          currentStart: current.start, currentEnd: current.end,
          priorSignedNotOnboarded: priorSigned, skipHubspot,
        }),
      });
      const json = (await res.json()) as OkResponse | ErrResponse;
      if (!json.ok) {
        setErr(json);
        setResult(null);
      } else {
        setResult(json);
        setCategoryOverrides({});
        setExpanded({});
        setUncombined({});
      }
    } catch (e) {
      setErr({ ok: false, error: (e as Error).message });
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const categoryOfUnit = (u: DisplayUnit): Category => categoryOverrides[u.id] ?? u.category;

  const displayUnits: DisplayUnit[] = result
    ? result.customers.flatMap((c): DisplayUnit[] => {
        if (uncombined[c.customerId]) {
          return c.agreements.map((a) => ({
            kind: "agreement", id: a.rowId, customerName: c.customerName, agreement: a, category: a.category,
          }));
        }
        return [{ kind: "customer", id: c.customerId, customer: c, category: c.category }];
      })
    : [];

  const effectiveUnits: DisplayUnit[] = displayUnits.map((u) => ({ ...u, category: categoryOfUnit(u) }));
  effectiveUnits.sort((a, b) => {
    const va = a.kind === "customer" ? a.customer.change : a.agreement.change;
    const vb = b.kind === "customer" ? b.customer.change : b.agreement.change;
    return va - vb;
  });

  const filteredUnits = filter === "all" ? effectiveUnits : effectiveUnits.filter((u) => u.category === filter);
  const unitChange = (u: DisplayUnit): number => u.kind === "customer" ? u.customer.change : u.agreement.change;

  const summary = result
    ? (() => {
        const sumBy = (cat: Category) =>
          effectiveUnits.filter((u) => u.category === cat).reduce((s, u) => s + unitChange(u), 0);
        const byCategory: Record<Category, number> = {} as Record<Category, number>;
        for (const cat of Object.keys(CATEGORY_META) as Category[]) {
          byCategory[cat] = round2(sumBy(cat));
        }
        const newMrr = round2(
          byCategory.new_acquisition_beginning +
          byCategory.recurring_licenses +
          byCategory.new_client +
          byCategory.price_increase +
          byCategory.upsell
        );
        const lostMrr = round2(
          byCategory.price_decrease + byCategory.downsell + byCategory.churn
        );
        const netChange = round2(result.endingMrr - result.beginningMrr);
        const mrrGrowthPct = result.beginningMrr === 0 ? 0 : round2((netChange / result.beginningMrr) * 100);
        const netRetained = result.beginningMrr + byCategory.upsell + byCategory.price_increase + byCategory.price_decrease + byCategory.downsell + byCategory.churn;
        const netMrrRetentionPct = result.beginningMrr === 0 ? 0 : round2((netRetained / result.beginningMrr) * 100);
        const grossRetained = result.beginningMrr + byCategory.price_decrease + byCategory.downsell + byCategory.churn;
        const grossMrrRetentionPct = result.beginningMrr === 0 ? 0 : round2((grossRetained / result.beginningMrr) * 100);
        return { byCategory, newMrr, lostMrr, netChange, mrrGrowthPct, netMrrRetentionPct, grossMrrRetentionPct };
      })()
    : null;

  function setUnitCategory(id: string, c: Category) { setCategoryOverrides((p) => ({ ...p, [id]: c })); }
  function toggleExpand(key: string) { setExpanded((p) => ({ ...p, [key]: !p[key] })); }
  function toggleUncombine(customerId: string) { setUncombined((p) => ({ ...p, [customerId]: !p[customerId] })); }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 rounded border border-slate-200 bg-white px-4 py-3">
        <MonthPicker label="Prior Month" value={priorMonth} onChange={setPriorMonth} />
        <MonthPicker label="Current Month" value={currentMonth} onChange={setCurrentMonth} />
        <label className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Prior signed / not onboarded</div>
          <input
            type="number" step={100} value={priorSigned}
            onChange={(e) => setPriorSigned(Number(e.target.value))}
            className="mt-1 w-36 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
        <button
          type="button" onClick={run} disabled={loading}
          className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Running…" : "Run bridge"}
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={skipHubspot} onChange={(e) => setSkipHubspot(e.target.checked)} />
          Skip HubSpot signed-not-onboarded
        </label>
      </div>

      {/* Category legend */}
      <div className="rounded border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setShowLegend((p) => !p)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left"
        >
          <span className="text-sm font-semibold text-slate-700">Category Key</span>
          <span className="text-xs text-slate-400">{showLegend ? "▾ Hide" : "▸ Show"}</span>
        </button>
        {showLegend && (
          <div className="border-t border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-[280px]">Category</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">When to use</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(CATEGORY_META) as Category[]).filter((c) => c !== "flat").map((cat) => (
                  <tr key={cat} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-800 align-top">
                      <span className={`inline-block mr-2 h-2 w-2 rounded-full align-middle ${signDot(CATEGORY_META[cat].sign)}`} />
                      {CATEGORY_META[cat].label}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{CATEGORY_META[cat].description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!hubspotConfigured && !skipHubspot && (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          HubSpot isn&apos;t configured in Settings — signed-not-onboarded will auto-skip if the API call fails.
        </div>
      )}

      {err && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <div className="font-medium">Bridge failed</div>
          <div className="mt-1 font-mono text-xs">{err.error}</div>
          {err.body && (
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-white p-2 text-[11px]">
              {JSON.stringify(err.body, null, 2)}
            </pre>
          )}
        </div>
      )}

      {result && summary && (
        <BridgeReport
          result={result} summary={summary} filter={filter} setFilter={setFilter}
          units={filteredUnits} uncombined={uncombined} expanded={expanded}
          onToggleExpand={toggleExpand} onToggleUncombine={toggleUncombine}
          onCategoryChange={setUnitCategory}
        />
      )}
    </div>
  );
}

function signDot(sign: "positive" | "negative" | "neutral"): string {
  return sign === "positive" ? "bg-emerald-500" : sign === "negative" ? "bg-red-400" : "bg-slate-400";
}

function MonthPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <input
        type="month" value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-1 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
      />
    </label>
  );
}

function BridgeReport({
  result, summary, filter, setFilter, units, uncombined, expanded, onToggleExpand, onToggleUncombine, onCategoryChange,
}: {
  result: OkResponse;
  summary: { byCategory: Record<Category, number>; newMrr: number; lostMrr: number; netChange: number; mrrGrowthPct: number; netMrrRetentionPct: number; grossMrrRetentionPct: number };
  filter: "all" | Category;
  setFilter: (v: "all" | Category) => void;
  units: DisplayUnit[];
  uncombined: Record<string, boolean>;
  expanded: Record<string, boolean>;
  onToggleExpand: (key: string) => void;
  onToggleUncombine: (customerId: string) => void;
  onCategoryChange: (id: string, c: Category) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-4 gap-3">
        <Stat label={`Beginning MRR (${result.priorPeriod})`} value={fmt(result.beginningMrr)} />
        <Stat label={`Ending MRR (${result.currentPeriod})`} value={fmt(result.endingMrr)} tone={summary.netChange >= 0 ? "ok" : "warn"} />
        <Stat label="Ending ARR" value={fmt(result.endingArr)} />
        <Stat label="Net change" value={fmt(summary.netChange)} tone={summary.netChange >= 0 ? "ok" : "warn"} />
      </div>

      {/* Bridge table */}
      <div className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
          Monthly Recurring Revenue Bridge
        </div>
        <table className="w-full text-sm">
          <tbody>
            <tr className="bg-slate-50 font-semibold">
              <td className="px-4 py-2">Beginning MRR</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmt(result.beginningMrr)}</td>
            </tr>
            {BRIDGE_ORDER.map((cat) => {
              const val = summary.byCategory[cat];
              const meta = CATEGORY_META[cat];
              const isEmpty = val === 0;
              return (
                <tr key={cat} className="border-t border-slate-100">
                  <td className={`px-4 py-1 pl-8 ${isEmpty ? "text-slate-400" : "text-slate-700"}`}>
                    {meta.label}
                  </td>
                  <td className={`px-4 py-1 text-right tabular-nums ${
                    isEmpty ? "text-slate-300" :
                    meta.sign === "positive" ? "text-emerald-700" :
                    meta.sign === "negative" ? "text-red-700" :
                    val >= 0 ? "text-emerald-700" : "text-red-700"
                  }`}>
                    {isEmpty ? "–" : fmt(val)}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <td className="px-4 py-2">Ending MRR</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmt(result.endingMrr)}</td>
            </tr>
            <tr>
              <td className="px-4 py-1 font-medium text-slate-700">Ending ARR</td>
              <td className="px-4 py-1 text-right tabular-nums font-medium">{fmt(result.endingArr)}</td>
            </tr>
            <BridgePct label="MRR growth %" value={summary.mrrGrowthPct} />
            <BridgePct label="Net MRR retention %" value={summary.netMrrRetentionPct} />
            <BridgePct label="Gross MRR retention %" value={summary.grossMrrRetentionPct} />
          </tbody>
        </table>
      </div>

      {/* Signed not onboarded */}
      <div className="rounded border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
          <div className="text-sm font-semibold text-slate-700">Signed, not yet onboarded</div>
          {result.hubspotSkipped && <span className="text-xs text-slate-500">HubSpot skipped</span>}
        </div>
        <table className="w-full text-sm">
          <tbody>
            <BridgeLine label="Beginning signed, not yet onboarded" value={result.beginningSignedNotOnboarded} />
            <BridgeLine label="Plus: new signed, not yet onboarded" value={result.newSignedNotOnboarded} tone="positive" />
            <BridgeLine label="Less: onboarded" value={result.lessOnboarded} tone="negative" />
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <td className="px-4 py-2">Ending signed, not yet onboarded</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmt(result.endingSignedNotOnboarded)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Movement detail */}
      <div className="rounded border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
          <div className="text-sm font-semibold text-slate-700">
            Movement detail · {units.length} row{units.length === 1 ? "" : "s"}
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            {(["all", ...BRIDGE_ORDER, "flat"] as const).map((c) => (
              <button
                key={c} type="button" onClick={() => setFilter(c as "all" | Category)}
                className={`rounded px-2 py-0.5 ${
                  filter === c
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {c === "all" ? "All" : CATEGORY_META[c as Category].label.replace(/^(New MRR, |Lost MRR, |New & Existing )/, "")}
              </button>
            ))}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2 text-left font-medium">Customer</th>
              <th className="px-3 py-2 text-right font-medium">{result.priorPeriod}</th>
              <th className="px-3 py-2 text-right font-medium">{result.currentPeriod}</th>
              <th className="px-3 py-2 text-right font-medium">Net change</th>
              <th className="px-3 py-2 text-left font-medium w-[220px]">Category</th>
            </tr>
          </thead>
          <tbody>
            {units.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No rows in this filter.</td></tr>
            )}
            {units.map((u) => {
              if (u.kind === "customer") {
                const c = u.customer;
                const customerKey = `cust:${c.customerId}`;
                const isOpen = expanded[customerKey] ?? false;
                const canExpand = c.agreements.length > 0;
                const isUncombined = uncombined[c.customerId] ?? false;
                return (
                  <Fragment key={`cust:${c.customerId}`}>
                    <tr className={`border-t border-slate-100 ${toneForCategory(u.category)}`}>
                      <td className="px-2 py-1.5 text-center">
                        {canExpand && (
                          <button type="button" onClick={() => onToggleExpand(customerKey)} className="text-slate-400 hover:text-slate-700">
                            {isOpen ? "▾" : "▸"}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-900">{c.customerName}</span>
                          {c.agreements.length > 1 && (
                            <button
                              type="button" onClick={() => onToggleUncombine(c.customerId)}
                              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
                              title={isUncombined ? "Re-combine" : "Uncombine into separate agreement rows"}
                            >
                              {isUncombined ? "Re-combine" : "Uncombine"}
                            </button>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500">{c.agreements.length} agreement{c.agreements.length === 1 ? "" : "s"} · combined</div>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.priorMrr)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.currentMrr)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${changeTone(c.change)}`}>{fmt(c.change)}</td>
                      <td className="px-3 py-1.5"><CategorySelect value={u.category} onChange={(cat) => onCategoryChange(u.id, cat)} /></td>
                    </tr>
                    {isOpen && canExpand && (
                      <tr className="bg-slate-50/40">
                        <td /><td colSpan={5} className="px-4 py-2">
                          <AgreementsTable customerId={c.customerId} agreements={c.agreements} priorLabel={result.priorPeriod} currentLabel={result.currentPeriod} expanded={expanded} onToggleExpand={onToggleExpand} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              }
              const a = u.agreement;
              const agrKey = `agr-inline:${u.id}`;
              const isOpen = expanded[agrKey] ?? false;
              const canExpand = (a.products?.length ?? 0) > 0;
              return (
                <Fragment key={u.id}>
                  <tr className={`border-t border-slate-100 ${toneForCategory(u.category)}`}>
                    <td className="px-2 py-1.5 text-center">
                      {canExpand && (
                        <button type="button" onClick={() => onToggleExpand(agrKey)} className="text-slate-400 hover:text-slate-700">
                          {isOpen ? "▾" : "▸"}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-900">{u.customerName}</span>
                        <button
                          type="button"
                          onClick={() => onToggleUncombine(result.customers.find((x) => x.customerName === u.customerName)?.customerId ?? u.customerName)}
                          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
                          title="Re-combine this customer's agreements"
                        >Re-combine</button>
                      </div>
                      <div className="text-[11px] text-slate-500">{a.agreement}</div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(a.priorMrr)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(a.currentMrr)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${changeTone(a.change)}`}>{fmt(a.change)}</td>
                    <td className="px-3 py-1.5"><CategorySelect value={u.category} onChange={(cat) => onCategoryChange(u.id, cat)} /></td>
                  </tr>
                  {isOpen && canExpand && (
                    <tr className="bg-slate-50/40"><td /><td colSpan={5} className="px-4 py-2"><ProductDetailTable products={a.products!} /></td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {result.signedDeals.length > 0 && (
        <div className="rounded border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
            HubSpot Closed-Won deals ({result.signedDeals.length})
          </div>
          <table className="w-full text-sm">
            <thead className="text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Deal</th>
                <th className="px-3 py-2 text-left font-medium">Company</th>
                <th className="px-3 py-2 text-right font-medium">MRR</th>
                <th className="px-3 py-2 text-left font-medium w-[110px]">Close date</th>
              </tr>
            </thead>
            <tbody>
              {result.signedDeals.map((d, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-900">{d.dealName}</td>
                  <td className="px-3 py-1.5 text-slate-600">{d.company}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(d.mrr)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{d.closeDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function changeTone(v: number): string {
  return v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : "text-slate-500";
}

function toneForCategory(c: Category): string {
  switch (c) {
    case "churn": return "bg-red-50/50";
    case "new_client": return "bg-sky-50/50";
    case "new_acquisition_beginning": return "bg-sky-50/30";
    case "price_increase": return "bg-indigo-50/50";
    case "upsell": return "bg-emerald-50/40";
    default: return "";
  }
}

function AgreementsTable({ customerId, agreements, priorLabel, currentLabel, expanded, onToggleExpand }: {
  customerId: string; agreements: BridgeLine[]; priorLabel: string; currentLabel: string;
  expanded: Record<string, boolean>; onToggleExpand: (key: string) => void;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
        Agreements ({agreements.length})
      </div>
      <table className="w-full text-[11px]">
        <thead className="text-slate-600">
          <tr>
            <th className="w-6 px-2 py-1" />
            <th className="px-3 py-1 text-left font-medium">Agreement</th>
            <th className="px-3 py-1 text-right font-medium">{priorLabel}</th>
            <th className="px-3 py-1 text-right font-medium">{currentLabel}</th>
            <th className="px-3 py-1 text-right font-medium">Change</th>
            <th className="px-3 py-1 text-left font-medium">Classifier</th>
          </tr>
        </thead>
        <tbody>
          {agreements.map((a) => {
            const key = `agr:${customerId}:${a.rowId}`;
            const isOpen = expanded[key] ?? false;
            const canExpand = (a.products?.length ?? 0) > 0;
            return (
              <Fragment key={a.rowId}>
                <tr className="border-t border-slate-100">
                  <td className="px-2 py-1 text-center">
                    {canExpand && (
                      <button type="button" onClick={() => onToggleExpand(key)} className="text-slate-400 hover:text-slate-700">
                        {isOpen ? "▾" : "▸"}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-1 text-slate-700">{a.agreement}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{fmt(a.priorMrr)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{fmt(a.currentMrr)}</td>
                  <td className={`px-3 py-1 text-right tabular-nums font-medium ${changeTone(a.change)}`}>{fmt(a.change)}</td>
                  <td className="px-3 py-1 text-slate-500">{CATEGORY_META[a.category]?.label ?? a.category}</td>
                </tr>
                {isOpen && canExpand && (
                  <tr className="bg-white"><td /><td colSpan={5} className="px-3 py-2"><ProductDetailTable products={a.products!} /></td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "ok" | "warn" }) {
  const toneClass = tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-red-700" : "text-slate-900";
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 font-mono text-lg tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function BridgeLine({ label, value, tone }: { label: string; value: number; tone?: "positive" | "negative" }) {
  const toneClass = tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-700" : "text-slate-900";
  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-1 text-slate-700">{label}</td>
      <td className={`px-4 py-1 text-right tabular-nums ${toneClass}`}>{fmt(value)}</td>
    </tr>
  );
}

function BridgePct({ label, value }: { label: string; value: number }) {
  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-1 text-slate-700">{label}</td>
      <td className="px-4 py-1 text-right tabular-nums">{value.toFixed(2)}%</td>
    </tr>
  );
}

function CategorySelect({ value, onChange }: { value: Category; onChange: (c: Category) => void }) {
  const colorClass =
    value === "new_client" ? "bg-sky-100 text-sky-900 border-sky-200" :
    value === "new_acquisition_beginning" ? "bg-sky-50 text-sky-800 border-sky-200" :
    value === "price_increase" ? "bg-indigo-100 text-indigo-900 border-indigo-200" :
    value === "upsell" ? "bg-emerald-100 text-emerald-900 border-emerald-200" :
    value === "price_decrease" ? "bg-orange-100 text-orange-900 border-orange-200" :
    value === "downsell" ? "bg-amber-100 text-amber-900 border-amber-200" :
    value === "churn" ? "bg-red-100 text-red-900 border-red-200" :
    value === "fx_adjustment" || value === "one_time_adj" ? "bg-purple-100 text-purple-900 border-purple-200" :
    value === "recurring_licenses" ? "bg-teal-100 text-teal-900 border-teal-200" :
    "bg-slate-100 text-slate-700 border-slate-200";

  return (
    <select
      value={value} onChange={(e) => onChange(e.target.value as Category)}
      className={`w-full rounded border px-1.5 py-0.5 text-[11px] font-medium ${colorClass}`}
    >
      {(Object.keys(CATEGORY_META) as Category[]).map((cat) => (
        <option key={cat} value={cat}>{CATEGORY_META[cat].label}</option>
      ))}
    </select>
  );
}

function ProductDetailTable({ products }: { products: ProductChange[] }) {
  return (
    <div className="rounded border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
        Product detail ({products.length})
      </div>
      <table className="w-full text-[11px]">
        <thead className="text-slate-600">
          <tr>
            <th className="px-3 py-1 text-left font-medium">Product</th>
            <th className="px-3 py-1 text-left font-medium">Subcategory</th>
            <th className="px-3 py-1 text-right font-medium">Prior qty × price</th>
            <th className="px-3 py-1 text-right font-medium">Current qty × price</th>
            <th className="px-3 py-1 text-right font-medium">Change</th>
            <th className="px-3 py-1 text-left font-medium">Movement</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.productId} className="border-t border-slate-100">
              <td className="px-3 py-1 font-mono text-slate-900">{p.productId}</td>
              <td className="px-3 py-1 text-slate-600">{p.subcategory || "—"}</td>
              <td className="px-3 py-1 text-right tabular-nums text-slate-600">
                {p.priorQuantity ? `${p.priorQuantity} × ${fmt(p.priorUnitPrice)}` : "—"}
              </td>
              <td className="px-3 py-1 text-right tabular-nums text-slate-600">
                {p.currentQuantity ? `${p.currentQuantity} × ${fmt(p.currentUnitPrice)}` : "—"}
              </td>
              <td className={`px-3 py-1 text-right tabular-nums font-medium ${changeTone(p.change)}`}>{fmt(p.change)}</td>
              <td className="px-3 py-1">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                  {productCategoryLabel(p.category)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function productCategoryLabel(c: ProductChange["category"]): string {
  switch (c) {
    case "new_product": return "New product";
    case "removed_product": return "Removed";
    case "price_increase": return "Price ↑";
    case "upsell": return "Upsell";
    case "downsell": return "Downsell";
    case "flat": return "Flat";
  }
}
