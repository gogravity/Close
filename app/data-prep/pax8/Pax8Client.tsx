"use client";

import React, { useState, useEffect, useCallback } from "react";
import MetricCard from "@/components/MetricCard";
import type {
  Pax8InvoicesResponse,
  Pax8InvoicesErrorResponse,
} from "@/app/api/pax8/invoices/route";
import type {
  Pax8InvoiceDetailResponse,
  Pax8InvoiceDetailErrorResponse,
} from "@/app/api/pax8/invoices/[id]/route";
import type {
  IronscalesResponse,
  IronscalesErrorResponse,
} from "@/app/api/ironscales/route";
import type { Pax8Invoice, Pax8InvoiceItem, InvoiceSummary, EstimatedBill, CurrentBillEstimate } from "@/lib/pax8";
import type { Pax8EstimateResponse, Pax8EstimateErrorResponse } from "@/app/api/pax8/estimate/route";
import type { IronscalesCompanyStats } from "@/lib/ironscales";
import type { AzureCostResponse, AzureCostErrorResponse } from "@/app/api/azure/cost/route";
import type { AzureCostResult } from "@/lib/azureCostManagement";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(s: string) {
  if (!s) return "—";
  return new Date(s + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function StatusPill({ status }: { status: string }) {
  const s = (status ?? "").toLowerCase();
  const cls =
    s === "paid"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : s === "open" || s === "unpaid"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : s === "past due"
      ? "bg-red-50 text-red-700 ring-red-200"
      : "bg-slate-100 text-slate-500 ring-slate-200";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${cls}`}>
      {status}
    </span>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

type Tab = "overview" | "clients" | "lineitems" | "ironscales" | "azure";

function Tabs({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "overview",   label: "Overview" },
    { id: "clients",    label: "Per Client" },
    { id: "lineitems",  label: "Line Items" },
    { id: "ironscales", label: "Ironscales Seats" },
    { id: "azure",      label: "Azure Cost" },
  ];
  return (
    <div className="flex gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            active === t.id
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Current Bill Estimate section ─────────────────────────────────────────────

function CurrentBillSection() {
  const [loading, setLoading]       = useState(false);
  const [estimate, setEstimate]     = useState<CurrentBillEstimate | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());
  // pct overrides: bucket label → % of baseline to use (default 100)
  const [pctOverrides, setPctOverrides] = useState<Record<string, number>>({});

  async function calculate() {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/pax8/estimate");
      const json = await res.json() as Pax8EstimateResponse | Pax8EstimateErrorResponse;
      if (!json.ok) { setError((json as Pax8EstimateErrorResponse).error); return; }
      setEstimate((json as Pax8EstimateResponse).estimate);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function toggleBucket(label: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  function setPct(label: string, raw: string) {
    const v = parseFloat(raw);
    if (isNaN(v)) return;
    setPctOverrides((prev) => ({ ...prev, [label]: Math.max(0, Math.min(200, v)) }));
  }

  // Derive adjusted totals — apply pct overrides to static (no-API-change) buckets
  const adjustedBuckets = (estimate?.buckets ?? []).map((b) => {
    const isStatic = b.changes.length === 0; // no live-count or sub changes
    if (!isStatic) return b;
    const pct      = pctOverrides[b.label] ?? 100;
    const adjTotal = Math.round(b.baseline * (pct / 100) * 100) / 100;
    const adjDelta = Math.round((adjTotal - b.baseline) * 100) / 100;
    return { ...b, delta: adjDelta, total: adjTotal };
  });

  const adjGrandTotal  = Math.round(adjustedBuckets.reduce((s, b) => s + b.total, 0) * 100) / 100;
  const adjDeltaTotal  = Math.round(adjustedBuckets.reduce((s, b) => s + b.delta, 0) * 100) / 100;
  const adjBaseline    = estimate?.assumptions.baselineTotal ?? 0;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Current Month Estimate</h3>
          {estimate && (
            <p className="mt-0.5 text-[10px] text-slate-400">
              Based on {fmtDate(estimate.baselineInvoiceDate)} invoice ·
              {estimate.assumptions.newSubsAdded > 0 && ` +${estimate.assumptions.newSubsAdded} new`}
              {estimate.assumptions.cancelledSubsRemoved > 0 && ` −${estimate.assumptions.cancelledSubsRemoved} cancelled`}
              {estimate.assumptions.ironscalesLiveCount !== null && ` · ${estimate.assumptions.ironscalesLiveCount} Ironscales seats live`}
            </p>
          )}
        </div>
        <button
          onClick={calculate}
          disabled={loading}
          className="h-8 rounded-md bg-blue-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Calculating…" : estimate ? "Recalculate" : "Calculate Current Bill"}
        </button>
      </div>

      {error && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-10 text-sm text-slate-400">
          Fetching live subscriptions and Ironscales seat counts…
        </div>
      )}

      {estimate && !loading && (
        <>
          {/* Grand total banner */}
          <div className="flex items-baseline gap-3 border-b border-slate-100 px-5 py-4">
            <span className="text-3xl font-semibold tabular-nums text-slate-800">{fmtMoney(adjGrandTotal)}</span>
            <span className="text-sm text-slate-400">estimated this month</span>
            <span className={`ml-auto text-sm font-medium tabular-nums ${adjDeltaTotal > 0 ? "text-red-600" : adjDeltaTotal < 0 ? "text-emerald-600" : "text-slate-400"}`}>
              {adjDeltaTotal >= 0 ? "+" : ""}{fmtMoney(adjDeltaTotal)} vs baseline
            </span>
          </div>

          {/* Bucket table */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="w-6 px-2 py-2" />
                <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Category</th>
                <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Baseline</th>
                <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Delta</th>
                <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Estimate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {adjustedBuckets.filter((b) => b.total !== 0 || b.baseline !== 0).map((bucket) => {
                const isOpen      = expanded.has(bucket.label);
                const hasChanges  = bucket.changes.length > 0;
                const isStatic    = !hasChanges; // shows pct input
                const pct         = pctOverrides[bucket.label] ?? 100;
                return (
                  <React.Fragment key={bucket.label}>
                    <tr
                      className={`${hasChanges ? "cursor-pointer hover:bg-slate-50" : ""}`}
                      onClick={() => hasChanges && toggleBucket(bucket.label)}
                    >
                      <td className="px-2 py-2.5 text-center text-[10px] text-slate-400">
                        {hasChanges ? (isOpen ? "▾" : "▸") : ""}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-700">
                        {bucket.label}
                        {bucket.label === "Azure" && bucket.changes.length === 0 && (
                          <span className="ml-2 text-[10px] text-slate-400">(last invoice)</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{fmtMoney(bucket.baseline)}</td>
                      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {isStatic ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              min={0}
                              max={200}
                              step={1}
                              value={pct}
                              onChange={(e) => setPct(bucket.label, e.target.value)}
                              className="w-14 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-xs tabular-nums text-slate-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                            <span className="text-xs text-slate-400">%</span>
                            {bucket.delta !== 0 && (
                              <span className={`ml-1 text-xs font-medium tabular-nums ${bucket.delta > 0 ? "text-red-600" : "text-emerald-600"}`}>
                                {bucket.delta > 0 ? "+" : ""}{fmtMoney(bucket.delta)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className={`tabular-nums text-xs font-medium ${bucket.delta > 0 ? "text-red-600" : bucket.delta < 0 ? "text-emerald-600" : "text-slate-400"}`}>
                            {bucket.delta !== 0 ? `${bucket.delta > 0 ? "+" : ""}${fmtMoney(bucket.delta)}` : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800">{fmtMoney(bucket.total)}</td>
                    </tr>
                    {isOpen && bucket.changes.map((ch, i) => (
                      <tr key={i} className="bg-slate-50/60">
                        <td />
                        <td colSpan={3} className="px-6 py-1.5 text-[11px] text-slate-500 truncate max-w-0" title={ch.description}>
                          {ch.description}
                        </td>
                        <td className={`px-4 py-1.5 text-right tabular-nums text-[11px] font-medium ${ch.cost > 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {ch.cost > 0 ? "+" : ""}{fmtMoney(ch.cost)}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td />
                <td className="px-4 py-3 text-sm font-semibold text-slate-700">Total</td>
                <td className="px-4 py-3 text-right tabular-nums text-sm text-slate-500">{fmtMoney(adjBaseline)}</td>
                <td className={`px-4 py-3 text-right tabular-nums text-sm font-medium ${adjDeltaTotal > 0 ? "text-red-600" : adjDeltaTotal < 0 ? "text-emerald-600" : "text-slate-400"}`}>
                  {adjDeltaTotal !== 0 ? `${adjDeltaTotal > 0 ? "+" : ""}${fmtMoney(adjDeltaTotal)}` : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-sm font-bold text-slate-800">{fmtMoney(adjGrandTotal)}</td>
              </tr>
            </tbody>
          </table>

          {estimate.assumptions.azureNote && (
            <div className="border-t border-slate-100 bg-amber-50 px-4 py-2 text-[10px] text-amber-700">
              ⚠ {estimate.assumptions.azureNote}
            </div>
          )}
        </>
      )}

      {!estimate && !loading && !error && (
        <div className="px-5 py-8 text-center text-sm text-slate-400">
          Click <span className="font-medium text-slate-600">Calculate Current Bill</span> to predict this month&apos;s Pax8 charges using the last invoice as baseline, adjusted for new and cancelled subscriptions and live Ironscales seat counts.
        </div>
      )}
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  summary,
  estimated,
  actualTotal,
}: {
  summary: InvoiceSummary;
  estimated: EstimatedBill;
  actualTotal: number;
}) {
  const [expandedCat, setExpandedCat] = useState<Set<string>>(new Set());

  function toggleCat(name: string) {
    setExpandedCat((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  const delta = actualTotal - estimated.totalEstimated;

  return (
    <div className="space-y-6">
      {/* Current Bill Estimate */}
      <CurrentBillSection />

      {/* Estimated vs Actual */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Estimated vs Actual</h3>
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-100 px-0">
          <div className="px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Subscription estimate</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-700">
              {fmtMoney(estimated.totalEstimated)}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-400">From active subscriptions · fixed costs only</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Actual invoice cost</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-700">{fmtMoney(actualTotal)}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">Partner cost per invoice</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Variance</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${delta > 0 ? "text-red-600" : delta < 0 ? "text-emerald-600" : "text-slate-700"}`}>
              {delta >= 0 ? "+" : ""}{fmtMoney(delta)}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-400">
              {delta > 500 ? "Actual exceeds estimate — check metered usage" :
               delta < -500 ? "Actual is under estimate" :
               "Within expected range"}
            </p>
          </div>
        </div>
        {estimated.meteredNote && (
          <div className="border-t border-slate-100 bg-amber-50 px-4 py-2 text-[10px] text-amber-700">
            ⚠ {estimated.meteredNote}
          </div>
        )}
      </div>

      {/* Cost breakdown by category */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Cost Accounting</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left">
              <th className="w-4 px-3 py-2" />
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Category</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Items</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Cost</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">% of total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {summary.byCategory.filter((c) => c.itemCount > 0).map((cat) => {
              const pct = summary.totalCost > 0 ? ((cat.cost / summary.totalCost) * 100).toFixed(1) : "0.0";
              return (
                <tr key={cat.name} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5" />
                  <td className="px-4 py-2.5 font-medium text-slate-700">{cat.name}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums text-slate-500">{cat.itemCount}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtMoney(cat.cost)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{pct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* By vendor */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">By Vendor</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left">
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Vendor</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Items</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Cost</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Revenue</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {summary.byVendor.map((v) => {
              const margin = v.revenue - v.cost;
              return (
                <tr key={v.name} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-700">{v.name}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums text-slate-500">{v.itemCount}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{fmtMoney(v.cost)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtMoney(v.revenue)}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums text-xs ${margin >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtMoney(margin)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Per-client tab ────────────────────────────────────────────────────────────

function ClientsTab({ summary }: { summary: InvoiceSummary }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  const filtered = summary.byCompany.filter(
    (c) => !search || c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="Search client…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-9 w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Client</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Items</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Cost</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Revenue</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((c) => {
              const margin = c.revenue - c.cost;
              return (
                <tr key={c.name} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-700">{c.name}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-slate-500">{c.itemCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{fmtMoney(c.cost)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmtMoney(c.revenue)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums text-xs ${margin >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtMoney(margin)}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-slate-400">No clients match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Line items tab ────────────────────────────────────────────────────────────

function LineItemsTab({ items }: { items: Pax8InvoiceItem[] }) {
  const [search, setSearch]   = useState("");
  const [vendor, setVendor]   = useState("");
  const [company, setCompany] = useState("");

  const vendors   = [...new Set(items.map((i) => i.vendorName  ?? "").filter(Boolean))].sort();
  const companies = [...new Set(items.map((i) => i.companyName ?? "").filter(Boolean))].sort();

  const filtered = items.filter((i) => {
    if (vendor  && i.vendorName  !== vendor)  return false;
    if (company && i.companyName !== company) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (i.productName  ?? "").toLowerCase().includes(q) ||
        (i.sku          ?? "").toLowerCase().includes(q) ||
        (i.description  ?? "").toLowerCase().includes(q) ||
        (i.companyName  ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-48 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All clients</option>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="flex items-center text-xs text-slate-400">{filtered.length} items</span>
      </div>

      <div className="overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Client</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Product</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Vendor</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">SKU</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Qty</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Term</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Cost</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 text-slate-600 max-w-[180px] truncate" title={item.companyName}>{item.companyName ?? "—"}</td>
                <td className="px-4 py-2.5 font-medium text-slate-700 max-w-[200px] truncate" title={item.productName}>{item.productName ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-500">{item.vendorName ?? "—"}</td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-slate-400">{item.sku ?? "—"}</td>
                <td className="px-4 py-2.5 text-center tabular-nums text-slate-600">{item.quantity ?? "—"}</td>
                <td className="px-4 py-2.5 text-center text-slate-500 capitalize">{item.term ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{fmtMoney(item.costTotal ?? 0)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtMoney(item.total ?? 0)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-slate-400">No items match the current filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Ironscales tab ────────────────────────────────────────────────────────────

function IronscalesTab() {
  const [loading, setLoading]   = useState(false);
  const [data, setData]         = useState<IronscalesResponse | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/ironscales");
      const json = await res.json() as IronscalesResponse | IronscalesErrorResponse;
      if (!json.ok) { setError((json as IronscalesErrorResponse).error); return; }
      setData(json as IronscalesResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = (data?.companies ?? []).filter(
    (c) => !search || c.companyName.toLowerCase().includes(search.toLowerCase()) || c.domain.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={load}
          disabled={loading}
          className="h-9 rounded-md bg-violet-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
        >
          {loading ? "Loading…" : data ? "Refresh" : "Load Ironscales data"}
        </button>
        {data && (
          <span className="text-xs text-slate-400">
            {data.totals.companyCount} companies · {data.totals.protectedMailboxes.toLocaleString()} protected seats
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <MetricCard label="Companies"          value={data.totals.companyCount}       tone="neutral" />
            <MetricCard label="Licensed mailboxes" value={data.totals.licensedMailboxes}  tone="neutral" />
            <MetricCard label="Protected mailboxes" value={data.totals.protectedMailboxes} tone={data.totals.protectedMailboxes > data.totals.licensedMailboxes ? "warn" : "ok"} />
          </div>

          <input
            type="text"
            placeholder="Search company or domain…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Company</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Domain</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Plan</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Licensed</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Protected</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-center">Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => {
                  const delta = c.protectedMailboxes - c.licensedMailboxes;
                  return (
                    <tr key={c.companyId} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-700">{c.companyName}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{c.domain}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-200">
                          {c.planType}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center tabular-nums text-slate-600">{c.licensedMailboxes}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums text-slate-600">{c.protectedMailboxes}</td>
                      <td className={`px-4 py-2.5 text-center tabular-nums text-xs font-medium ${
                        delta > 0 ? "text-red-600" : delta < 0 ? "text-amber-600" : "text-emerald-600"
                      }`}>
                        {delta > 0 ? `+${delta}` : delta}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-slate-400">No companies match.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            Delta = Protected − Licensed. Positive delta means more seats in use than licensed (over-deployed).
            Negative means spare capacity.
          </p>
        </>
      )}

      {!data && !loading && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 py-16 text-center">
          <svg className="mb-3 size-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/>
          </svg>
          <p className="text-sm font-medium text-slate-500">Click &ldquo;Load Ironscales data&rdquo; to fetch seat counts</p>
          <p className="mt-1 text-xs text-slate-400">Requires Ironscales credentials in Settings</p>
        </div>
      )}
    </div>
  );
}

// ── Azure Cost tab ────────────────────────────────────────────────────────────

function AzureCostTable({ result, title }: { result: AzureCostResult; title: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <span className="text-xs text-slate-400">
          Total: <span className="font-semibold text-slate-700">{fmtMoney(result.totalCost)}</span>
          {" · "}{result.currency}{" · "}as of {result.asOfDate}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Name</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">Cost</th>
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 text-right">% of Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result.rows.map((row, i) => {
              const pct = result.totalCost > 0 ? (row.cost / result.totalCost) * 100 : 0;
              return (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-700">{row.name}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{fmtMoney(row.cost)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs text-slate-400">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-20 rounded-full bg-slate-100">
                        <div
                          className="h-1.5 rounded-full bg-blue-400"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      {pct.toFixed(1)}%
                    </div>
                  </td>
                </tr>
              );
            })}
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={3} className="py-10 text-center text-sm text-slate-400">No cost data returned.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AzureCostTab() {
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<AzureCostResponse | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    setUnconfigured(false);
    try {
      const res  = await fetch("/api/azure/cost");
      const json = await res.json() as AzureCostResponse | AzureCostErrorResponse;
      if (!json.ok) {
        const err = (json as AzureCostErrorResponse).error;
        if (res.status === 400) setUnconfigured(true);
        else setError(err);
        return;
      }
      setData(json as AzureCostResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={load}
          disabled={loading}
          className="h-9 rounded-md bg-blue-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Loading…" : data ? "Refresh" : "Load Azure Cost data"}
        </button>
        {data && (
          <span className="text-xs text-slate-400">
            {data.byCustomer.rows.length} entries · scope: <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">{data.byCustomer.scope}</code>
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {unconfigured && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 py-16 text-center">
          <svg className="mb-3 size-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
          </svg>
          <p className="text-sm font-medium text-slate-500">Azure Cost Management not configured</p>
          <p className="mt-1 text-xs text-slate-400">Add credentials in <strong>Settings → Azure Cost Management</strong></p>
        </div>
      )}

      {data && (
        <>
          {/* Summary banner */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MetricCard label="Total MTD spend"    value={fmtMoney(data.byCustomer.totalCost)} tone="neutral" />
            <MetricCard label="Customers/Subs"     value={data.byCustomer.rows.length}          tone="neutral" />
            <MetricCard label="Services in use"    value={data.byService.rows.length}            tone="neutral" />
          </div>

          <AzureCostTable result={data.byCustomer} title="By Customer / Subscription" />
          <AzureCostTable result={data.byService}  title="By Azure Service" />
        </>
      )}

      {!data && !loading && !error && !unconfigured && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 py-16 text-center">
          <svg className="mb-3 size-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
          </svg>
          <p className="text-sm font-medium text-slate-500">Click &ldquo;Load Azure Cost data&rdquo; to fetch month-to-date spend</p>
          <p className="mt-1 text-xs text-slate-400">Requires Azure Cost Management credentials in Settings</p>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Pax8Client() {
  const [invoices, setInvoices]         = useState<Pax8Invoice[]>([]);
  const [estimated, setEstimated]       = useState<EstimatedBill | null>(null);
  const [selectedId, setSelectedId]     = useState<string>("");
  const [detail, setDetail]             = useState<Pax8InvoiceDetailResponse | null>(null);
  const [loadingList, setLoadingList]   = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [listError, setListError]       = useState<string | null>(null);
  const [detailError, setDetailError]   = useState<string | null>(null);
  const [tab, setTab]                   = useState<Tab>("overview");

  // Load invoice list on mount
  useEffect(() => {
    async function load() {
      setLoadingList(true);
      setListError(null);
      try {
        const res  = await fetch("/api/pax8/invoices");
        const json = await res.json() as Pax8InvoicesResponse | Pax8InvoicesErrorResponse;
        if (!json.ok) { setListError((json as Pax8InvoicesErrorResponse).error); return; }
        const r = json as Pax8InvoicesResponse;
        setInvoices(r.invoices);
        setEstimated(r.estimated);
        if (r.invoices.length > 0) setSelectedId(r.invoices[0].id);
      } catch (e) {
        setListError((e as Error).message);
      } finally {
        setLoadingList(false);
      }
    }
    load();
  }, []);

  // Load detail when selected invoice changes
  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    setLoadingDetail(true);
    setDetailError(null);
    setDetail(null);
    try {
      const res  = await fetch(`/api/pax8/invoices/${id}`);
      const json = await res.json() as Pax8InvoiceDetailResponse | Pax8InvoiceDetailErrorResponse;
      if (!json.ok) { setDetailError((json as Pax8InvoiceDetailErrorResponse).error); return; }
      setDetail(json as Pax8InvoiceDetailResponse);
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const selectedInvoice = invoices.find((i) => i.id === selectedId);

  if (loadingList) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-slate-400">
        Loading Pax8 invoices…
      </div>
    );
  }

  if (listError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {listError}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Invoice selector */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Invoice</label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {invoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {fmtDate(inv.invoiceDate)} — {fmtMoney(inv.total)} ({inv.status})
              </option>
            ))}
          </select>
        </div>
        {selectedInvoice && (
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <StatusPill status={selectedInvoice.status} />
            <span>Due {fmtDate(selectedInvoice.dueDate)}</span>
            {selectedInvoice.balance > 0 && (
              <span className="text-amber-600 font-medium">Balance: {fmtMoney(selectedInvoice.balance)}</span>
            )}
          </div>
        )}
      </div>

      {detailError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{detailError}</div>
      )}

      {loadingDetail && (
        <div className="flex items-center justify-center py-16 text-sm text-slate-400">
          Loading invoice detail…
        </div>
      )}

      {detail && !loadingDetail && estimated && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Invoice total"   value={fmtMoney(selectedInvoice?.total ?? 0)} tone="neutral" />
            <MetricCard label="Partner cost"    value={fmtMoney(detail.summary.totalCost)}    tone="neutral" />
            <MetricCard label="Revenue"         value={fmtMoney(detail.summary.totalRevenue)} tone="ok" />
            <MetricCard label="Clients"         value={detail.summary.companyCount}            tone="neutral" />
          </div>

          {/* Tabs */}
          <Tabs active={tab} onChange={setTab} />

          {tab === "overview" && (
            <OverviewTab
              summary={detail.summary}
              estimated={estimated}
              actualTotal={detail.summary.totalCost}
            />
          )}
          {tab === "clients" && <ClientsTab summary={detail.summary} />}
          {tab === "lineitems" && <LineItemsTab items={detail.items} />}
          {tab === "ironscales" && <IronscalesTab />}
          {tab === "azure"      && <AzureCostTab />}
        </>
      )}

      {invoices.length === 0 && !loadingList && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 py-16 text-center">
          <p className="text-sm font-medium text-slate-500">No Pax8 invoices found</p>
          <p className="mt-1 text-xs text-slate-400">Check that Pax8 credentials are configured in Settings</p>
        </div>
      )}
    </div>
  );
}
