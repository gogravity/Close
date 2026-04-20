"use client";

import { Fragment, useState } from "react";
import { fmt } from "@/lib/recon";

type Category =
  | "new_client"
  | "price_increase"
  | "upsell"
  | "downsell"
  | "churn"
  | "flat";

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
  category:
    | "new_product"
    | "removed_product"
    | "price_increase"
    | "upsell"
    | "downsell"
    | "flat";
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

// A row in the movement-detail table. Combined customers render as a single
// unit; uncombined customers get one unit per agreement.
type DisplayUnit =
  | { kind: "customer"; id: string; customer: BridgeCustomer; category: Category }
  | {
      kind: "agreement";
      id: string;
      customerName: string;
      agreement: BridgeLine;
      category: Category;
    };

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
  defaultPeriods: {
    priorStart: string;
    priorEnd: string;
    currentStart: string;
    currentEnd: string;
  };
  hubspotConfigured: boolean;
};

export default function MrrBridgeClient({ defaultPeriods, hubspotConfigured }: Props) {
  const [priorStart, setPriorStart] = useState(defaultPeriods.priorStart);
  const [priorEnd, setPriorEnd] = useState(defaultPeriods.priorEnd);
  const [currentStart, setCurrentStart] = useState(defaultPeriods.currentStart);
  const [currentEnd, setCurrentEnd] = useState(defaultPeriods.currentEnd);
  const [priorSigned, setPriorSigned] = useState(0);
  const [skipHubspot, setSkipHubspot] = useState(!hubspotConfigured);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OkResponse | null>(null);
  const [err, setErr] = useState<ErrResponse | null>(null);
  const [filter, setFilter] = useState<"all" | Category>("all");
  // Per-row category overrides the user sets manually. Empty until they change
  // anything — we fall back to the server's preset category otherwise.
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, Category>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Per-customer "uncombine" flag — when true, that customer's individual
  // agreements get promoted to top-level rows in the movement table (and
  // count separately in the summary). Lets the user decide case-by-case
  // whether a customer's credit-memo reversal should net against their
  // other agreements or stand alone.
  const [uncombined, setUncombined] = useState<Record<string, boolean>>({});

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/mrr-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priorStart,
          priorEnd,
          currentStart,
          currentEnd,
          priorSignedNotOnboarded: priorSigned,
          skipHubspot,
        }),
      });
      const json = (await res.json()) as OkResponse | ErrResponse;
      if (!json.ok) {
        setErr(json);
        setResult(null);
      } else {
        setResult(json);
        // Reset overrides when the underlying data set changes — the old rowIds
        // may no longer exist and stale overrides would quietly skew totals.
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

  const categoryOfUnit = (u: DisplayUnit): Category =>
    categoryOverrides[u.id] ?? u.category;

  const displayUnits: DisplayUnit[] = result
    ? result.customers.flatMap((c): DisplayUnit[] => {
        if (uncombined[c.customerId]) {
          return c.agreements.map((a) => ({
            kind: "agreement",
            id: a.rowId,
            customerName: c.customerName,
            agreement: a,
            category: a.category,
          }));
        }
        return [
          {
            kind: "customer",
            id: c.customerId,
            customer: c,
            category: c.category,
          },
        ];
      })
    : [];
  const effectiveUnits: DisplayUnit[] = displayUnits.map((u) => ({
    ...u,
    category: categoryOfUnit(u),
  }));

  // Sort within kind so combined customers and uncombined agreements both
  // appear largest-swing-first. Stable keeps relative order.
  effectiveUnits.sort((a, b) => {
    const va = a.kind === "customer" ? a.customer.change : a.agreement.change;
    const vb = b.kind === "customer" ? b.customer.change : b.agreement.change;
    return va - vb;
  });

  const filteredUnits =
    filter === "all"
      ? effectiveUnits
      : effectiveUnits.filter((u) => u.category === filter);

  const unitChange = (u: DisplayUnit): number =>
    u.kind === "customer" ? u.customer.change : u.agreement.change;

  // Summary stats from display-unit categories (post-override). Both
  // combined-customer and uncombined-agreement units count the same way.
  const summary = result
    ? (() => {
        const sumBy = (cat: Category) =>
          effectiveUnits
            .filter((u) => u.category === cat)
            .reduce((s, u) => s + unitChange(u), 0);
        const newClients = round2(sumBy("new_client"));
        const priceIncrease = round2(sumBy("price_increase"));
        const upsell = round2(sumBy("upsell"));
        const downsell = round2(sumBy("downsell"));
        const churn = round2(sumBy("churn"));
        const netChange = round2(result.endingMrr - result.beginningMrr);
        const mrrGrowthPct =
          result.beginningMrr === 0
            ? 0
            : round2((netChange / result.beginningMrr) * 100);
        const netRetained =
          result.beginningMrr + upsell + priceIncrease + downsell + churn;
        const netMrrRetentionPct =
          result.beginningMrr === 0
            ? 0
            : round2((netRetained / result.beginningMrr) * 100);
        const grossRetained = result.beginningMrr + downsell + churn;
        const grossMrrRetentionPct =
          result.beginningMrr === 0
            ? 0
            : round2((grossRetained / result.beginningMrr) * 100);
        return {
          newClients,
          priceIncrease,
          upsell,
          downsell,
          churn,
          netChange,
          mrrGrowthPct,
          netMrrRetentionPct,
          grossMrrRetentionPct,
        };
      })()
    : null;

  function setUnitCategory(id: string, c: Category) {
    setCategoryOverrides((p) => ({ ...p, [id]: c }));
  }
  function toggleExpand(key: string) {
    setExpanded((p) => ({ ...p, [key]: !p[key] }));
  }
  function toggleUncombine(customerId: string) {
    setUncombined((p) => ({ ...p, [customerId]: !p[customerId] }));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded border border-slate-200 bg-white px-4 py-3">
        <Period label="Prior start" value={priorStart} onChange={setPriorStart} />
        <Period label="Prior end" value={priorEnd} onChange={setPriorEnd} />
        <Period label="Current start" value={currentStart} onChange={setCurrentStart} />
        <Period label="Current end" value={currentEnd} onChange={setCurrentEnd} />
        <label className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Prior signed / not onboarded
          </div>
          <input
            type="number"
            step={100}
            value={priorSigned}
            onChange={(e) => setPriorSigned(Number(e.target.value))}
            className="mt-1 w-36 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Running…" : "Run bridge"}
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={skipHubspot}
            onChange={(e) => setSkipHubspot(e.target.checked)}
          />
          Skip HubSpot signed-not-onboarded
        </label>
      </div>

      {!hubspotConfigured && !skipHubspot && (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          HubSpot isn&apos;t configured in Settings — signed-not-onboarded will
          auto-skip if the API call fails.
        </div>
      )}

      {err && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <div className="font-medium">Bridge failed</div>
          <div className="mt-1 font-mono text-xs">{err.error}</div>
          {err.body ? (
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-white p-2 text-[11px]">
              {JSON.stringify(err.body, null, 2)}
            </pre>
          ) : null}
        </div>
      )}

      {result && summary && (
        <BridgeReport
          result={result}
          summary={summary}
          filter={filter}
          setFilter={setFilter}
          units={filteredUnits}
          uncombined={uncombined}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          onToggleUncombine={toggleUncombine}
          onCategoryChange={setUnitCategory}
        />
      )}
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function Period({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="text-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
      />
    </label>
  );
}

function BridgeReport({
  result,
  summary,
  filter,
  setFilter,
  units,
  uncombined,
  expanded,
  onToggleExpand,
  onToggleUncombine,
  onCategoryChange,
}: {
  result: OkResponse;
  summary: {
    newClients: number;
    priceIncrease: number;
    upsell: number;
    downsell: number;
    churn: number;
    netChange: number;
    mrrGrowthPct: number;
    netMrrRetentionPct: number;
    grossMrrRetentionPct: number;
  };
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
        <Stat
          label={`Ending MRR (${result.currentPeriod})`}
          value={fmt(result.endingMrr)}
          tone={summary.netChange >= 0 ? "ok" : "warn"}
        />
        <Stat label="Ending ARR" value={fmt(result.endingArr)} />
        <Stat
          label="Net change"
          value={fmt(summary.netChange)}
          tone={summary.netChange >= 0 ? "ok" : "warn"}
        />
      </div>

      <div className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
          Monthly Recurring Revenue bridge
        </div>
        <table className="w-full text-sm">
          <tbody>
            <Line label="Beginning MRR" value={result.beginningMrr} />
            <Line label="New MRR, new clients" value={summary.newClients} tone="positive" />
            <Line
              label="New MRR, price increase existing clients"
              value={summary.priceIncrease}
              tone="positive"
            />
            <Line label="New MRR, upsell existing clients" value={summary.upsell} tone="positive" />
            <Line
              label="Lost MRR, downsell existing clients"
              value={summary.downsell}
              tone="negative"
            />
            <Line label="Lost MRR, client churn" value={summary.churn} tone="negative" />
            <tr className="border-t-2 border-slate-700 bg-slate-50 font-semibold">
              <td className="px-4 py-2">Ending MRR</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmt(result.endingMrr)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="px-4 py-1 text-slate-700">Ending ARR</td>
              <td className="px-4 py-1 text-right tabular-nums">{fmt(result.endingArr)}</td>
            </tr>
            <Line label="MRR growth %" value={summary.mrrGrowthPct} format="pct" />
            <Line label="Net MRR retention %" value={summary.netMrrRetentionPct} format="pct" />
            <Line label="Gross MRR retention %" value={summary.grossMrrRetentionPct} format="pct" />
          </tbody>
        </table>
      </div>

      <div className="rounded border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
          <div className="text-sm font-semibold text-slate-700">
            Signed, not yet onboarded
          </div>
          {result.hubspotSkipped && (
            <span className="text-xs text-slate-500">HubSpot skipped</span>
          )}
        </div>
        <table className="w-full text-sm">
          <tbody>
            <Line
              label="Beginning signed, not yet onboarded"
              value={result.beginningSignedNotOnboarded}
            />
            <Line
              label="Plus: new signed, not yet onboarded"
              value={result.newSignedNotOnboarded}
              tone="positive"
            />
            <Line label="Less: onboarded" value={result.lessOnboarded} tone="negative" />
            <tr className="border-t-2 border-slate-700 bg-slate-50 font-semibold">
              <td className="px-4 py-2">Ending signed, not yet onboarded</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {fmt(result.endingSignedNotOnboarded)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
          <div className="text-sm font-semibold text-slate-700">
            Movement detail · {units.length} row{units.length === 1 ? "" : "s"}
          </div>
          <div className="flex gap-1 text-xs">
            {(
              [
                "all",
                "new_client",
                "price_increase",
                "upsell",
                "downsell",
                "churn",
              ] as const
            ).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setFilter(c)}
                className={`rounded px-2 py-0.5 ${
                  filter === c
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-100"
                }`}
              >
                {c === "all" ? "All" : categoryLabel(c)}
              </button>
            ))}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-white text-slate-600">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2 text-left font-medium">Customer</th>
              <th className="px-3 py-2 text-right font-medium">{result.priorPeriod}</th>
              <th className="px-3 py-2 text-right font-medium">{result.currentPeriod}</th>
              <th className="px-3 py-2 text-right font-medium">Net change</th>
              <th className="px-3 py-2 text-left font-medium w-[150px]">Category</th>
            </tr>
          </thead>
          <tbody>
            {units.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  No rows in this filter.
                </td>
              </tr>
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
                    <tr
                      className={`border-t border-slate-100 ${toneForCategory(u.category)}`}
                    >
                      <td className="px-2 py-1.5 text-center">
                        {canExpand ? (
                          <button
                            type="button"
                            onClick={() => onToggleExpand(customerKey)}
                            className="text-slate-400 hover:text-slate-700"
                            aria-label={isOpen ? "Collapse" : "Expand"}
                          >
                            {isOpen ? "▾" : "▸"}
                          </button>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-900">{c.customerName}</span>
                          {c.agreements.length > 1 && (
                            <button
                              type="button"
                              onClick={() => onToggleUncombine(c.customerId)}
                              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
                              title={
                                isUncombined
                                  ? "Re-combine this customer's agreements"
                                  : "Uncombine into separate agreement rows"
                              }
                            >
                              Uncombine
                            </button>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {c.agreements.length} agreement{c.agreements.length === 1 ? "" : "s"} · combined
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.priorMrr)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.currentMrr)}</td>
                      <td
                        className={`px-3 py-1.5 text-right tabular-nums font-medium ${
                          c.change > 0
                            ? "text-emerald-700"
                            : c.change < 0
                              ? "text-red-700"
                              : "text-slate-500"
                        }`}
                      >
                        {fmt(c.change)}
                      </td>
                      <td className="px-3 py-1.5">
                        <CategorySelect
                          value={u.category}
                          onChange={(cat) => onCategoryChange(u.id, cat)}
                        />
                      </td>
                    </tr>
                    {isOpen && canExpand && (
                      <tr className="bg-slate-50/40">
                        <td />
                        <td colSpan={5} className="px-4 py-2">
                          <AgreementsTable
                            customerId={c.customerId}
                            agreements={c.agreements}
                            priorLabel={result.priorPeriod}
                            currentLabel={result.currentPeriod}
                            expanded={expanded}
                            onToggleExpand={onToggleExpand}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              }
              // kind === "agreement" — promoted from an uncombined customer.
              const a = u.agreement;
              const agrKey = `agr-inline:${u.id}`;
              const isOpen = expanded[agrKey] ?? false;
              const canExpand = (a.products?.length ?? 0) > 0;
              return (
                <Fragment key={u.id}>
                  <tr
                    className={`border-t border-slate-100 ${toneForCategory(u.category)}`}
                  >
                    <td className="px-2 py-1.5 text-center">
                      {canExpand ? (
                        <button
                          type="button"
                          onClick={() => onToggleExpand(agrKey)}
                          className="text-slate-400 hover:text-slate-700"
                        >
                          {isOpen ? "▾" : "▸"}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-900">{u.customerName}</span>
                        <button
                          type="button"
                          onClick={() =>
                            onToggleUncombine(
                              result.customers.find((x) => x.customerName === u.customerName)
                                ?.customerId ?? u.customerName
                            )
                          }
                          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
                          title="Re-combine this customer's agreements"
                        >
                          Re-combine
                        </button>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {a.agreement}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(a.priorMrr)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(a.currentMrr)}</td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums font-medium ${
                        a.change > 0
                          ? "text-emerald-700"
                          : a.change < 0
                            ? "text-red-700"
                            : "text-slate-500"
                      }`}
                    >
                      {fmt(a.change)}
                    </td>
                    <td className="px-3 py-1.5">
                      <CategorySelect
                        value={u.category}
                        onChange={(cat) => onCategoryChange(u.id, cat)}
                      />
                    </td>
                  </tr>
                  {isOpen && canExpand && (
                    <tr className="bg-slate-50/40">
                      <td />
                      <td colSpan={5} className="px-4 py-2">
                        <ProductDetailTable products={a.products!} />
                      </td>
                    </tr>
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

function AgreementsTable({
  customerId,
  agreements,
  priorLabel,
  currentLabel,
  expanded,
  onToggleExpand,
}: {
  customerId: string;
  agreements: BridgeLine[];
  priorLabel: string;
  currentLabel: string;
  expanded: Record<string, boolean>;
  onToggleExpand: (key: string) => void;
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
                    {canExpand ? (
                      <button
                        type="button"
                        onClick={() => onToggleExpand(key)}
                        className="text-slate-400 hover:text-slate-700"
                      >
                        {isOpen ? "▾" : "▸"}
                      </button>
                    ) : null}
                  </td>
                  <td className="px-3 py-1 text-slate-700">{a.agreement}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{fmt(a.priorMrr)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{fmt(a.currentMrr)}</td>
                  <td
                    className={`px-3 py-1 text-right tabular-nums font-medium ${
                      a.change > 0
                        ? "text-emerald-700"
                        : a.change < 0
                          ? "text-red-700"
                          : "text-slate-500"
                    }`}
                  >
                    {fmt(a.change)}
                  </td>
                  <td className="px-3 py-1 text-slate-500">
                    {categoryLabel(a.category)}
                  </td>
                </tr>
                {isOpen && canExpand && (
                  <tr className="bg-white">
                    <td />
                    <td colSpan={5} className="px-3 py-2">
                      <ProductDetailTable products={a.products!} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-red-700"
        : "text-slate-900";
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-lg tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function Line({
  label,
  value,
  tone,
  format = "money",
}: {
  label: string;
  value: number;
  tone?: "positive" | "negative";
  format?: "money" | "pct";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "negative"
        ? "text-red-700"
        : "text-slate-900";
  const display = format === "pct" ? `${value.toFixed(2)}%` : fmt(value);
  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-1 text-slate-700">{label}</td>
      <td className={`px-4 py-1 text-right tabular-nums ${toneClass}`}>{display}</td>
    </tr>
  );
}

function categoryLabel(c: Category): string {
  switch (c) {
    case "new_client":
      return "New client";
    case "price_increase":
      return "Price Increase";
    case "upsell":
      return "Upsell";
    case "downsell":
      return "Downsell";
    case "churn":
      return "Churn";
    case "flat":
      return "Flat";
  }
}

function toneForCategory(c: Category): string {
  switch (c) {
    case "churn":
      return "bg-red-50/50";
    case "new_client":
      return "bg-sky-50/50";
    case "price_increase":
      return "bg-indigo-50/50";
    default:
      return "";
  }
}

function CategorySelect({
  value,
  onChange,
}: {
  value: Category;
  onChange: (c: Category) => void;
}) {
  const toneClass =
    value === "new_client"
      ? "bg-sky-100 text-sky-900 border-sky-200"
      : value === "price_increase"
        ? "bg-indigo-100 text-indigo-900 border-indigo-200"
        : value === "upsell"
          ? "bg-emerald-100 text-emerald-900 border-emerald-200"
          : value === "downsell"
            ? "bg-amber-100 text-amber-900 border-amber-200"
            : value === "churn"
              ? "bg-red-100 text-red-900 border-red-200"
              : "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Category)}
      className={`w-full rounded border px-1.5 py-0.5 text-[11px] font-medium ${toneClass}`}
    >
      <option value="new_client">New client</option>
      <option value="price_increase">Price increase</option>
      <option value="upsell">Upsell</option>
      <option value="downsell">Downsell</option>
      <option value="churn">Churn</option>
      <option value="flat">Flat</option>
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
          {products.map((p) => {
            const changeTone =
              p.change > 0
                ? "text-emerald-700"
                : p.change < 0
                  ? "text-red-700"
                  : "text-slate-400";
            return (
              <tr key={p.productId} className="border-t border-slate-100">
                <td className="px-3 py-1 font-mono text-slate-900">{p.productId}</td>
                <td className="px-3 py-1 text-slate-600">{p.subcategory || "—"}</td>
                <td className="px-3 py-1 text-right tabular-nums text-slate-600">
                  {p.priorQuantity
                    ? `${p.priorQuantity} × ${fmt(p.priorUnitPrice)}`
                    : "—"}
                </td>
                <td className="px-3 py-1 text-right tabular-nums text-slate-600">
                  {p.currentQuantity
                    ? `${p.currentQuantity} × ${fmt(p.currentUnitPrice)}`
                    : "—"}
                </td>
                <td
                  className={`px-3 py-1 text-right tabular-nums font-medium ${changeTone}`}
                >
                  {fmt(p.change)}
                </td>
                <td className="px-3 py-1">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                    {productCategoryLabel(p.category)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function productCategoryLabel(c: ProductChange["category"]): string {
  switch (c) {
    case "new_product":
      return "New product";
    case "removed_product":
      return "Removed";
    case "price_increase":
      return "Price ↑";
    case "upsell":
      return "Upsell";
    case "downsell":
      return "Downsell";
    case "flat":
      return "Flat";
  }
}
