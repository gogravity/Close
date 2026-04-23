/**
 * Pax8 API client — ported from stratus-bot/sync/pax8_invoices.py
 *
 * Auth: OAuth2 client_credentials → https://api.pax8.com/v1/token
 * Base: https://api.pax8.com
 */
import "server-only";
import { getIntegrationSecrets } from "./settings";

export class Pax8Error extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "Pax8Error";
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  const s = await getIntegrationSecrets("pax8");
  if (!s.clientId || !s.clientSecret)
    throw new Pax8Error("Pax8 credentials not configured — add them in Settings → Pax8", 400);
  return { clientId: s.clientId, clientSecret: s.clientSecret };
}

async function getToken(): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 30_000) return _tokenCache.token;

  const { clientId, clientSecret } = await getCredentials();
  // Pax8 requires a JSON body with an audience field (not form-encoded)
  const res = await fetch("https://api.pax8.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      audience: "https://api.pax8.com",
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Pax8Error(`Pax8 auth failed (${res.status}): ${body}`, res.status);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  _tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in - 60) * 1000,
  };
  return _tokenCache.token;
}

async function pax8Get<T>(
  path: string,
  params?: Record<string, string | number>
): Promise<T> {
  const token = await getToken();
  const url = new URL(`https://api.pax8.com${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Pax8Error(`Pax8 ${path} failed (${res.status}): ${body}`, res.status);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type Pax8Invoice = {
  id: string;
  invoiceDate: string;
  dueDate: string;
  total: number;
  balance: number;
  status: string;
  partnerName?: string;
  companyId?: string;
  externalId?: string;
};

export type Pax8InvoiceItem = {
  id: string;
  type?: string;
  companyId?: string;
  companyName?: string;
  productId?: string;
  productName?: string;
  vendorName?: string;
  sku?: string;
  description?: string;
  quantity?: number;
  unitOfMeasure?: string;
  term?: string;
  rateType?: string;
  chargeType?: string;
  price?: number;
  subTotal?: number;
  cost?: number;
  costTotal?: number;
  total?: number;
  amountDue?: number;
  salesTax?: number;
  billingFee?: number;
  startPeriod?: string;
  endPeriod?: string;
  subscriptionId?: string;
  offeredBy?: string;
};

export type Pax8Subscription = {
  id: string;
  productId: string;
  quantity: number;
  partnerCost?: number;
  price?: number;
  billingTerm?: string;
  companyId?: string;
  status?: string;
  startDate?: string;
  billingStart?: string;
};

// ── API calls ─────────────────────────────────────────────────────────────────

export async function listInvoices(size = 12): Promise<Pax8Invoice[]> {
  const data = await pax8Get<{
    content: Pax8Invoice[];
    page: { totalPages: number };
  }>("/v1/invoices", { page: 0, size, sort: "invoiceDate,DESC" });
  return data.content ?? [];
}

export async function getInvoiceItems(invoiceId: string): Promise<Pax8InvoiceItem[]> {
  const items: Pax8InvoiceItem[] = [];
  let page = 0;
  while (true) {
    const data = await pax8Get<{
      content: Pax8InvoiceItem[];
      page: { totalPages: number };
    }>(`/v1/invoices/${invoiceId}/items`, { page, size: 200 });
    items.push(...(data.content ?? []));
    if (page + 1 >= (data.page?.totalPages ?? 1)) break;
    page++;
  }
  return items;
}

export async function listActiveSubscriptions(): Promise<Pax8Subscription[]> {
  const subs: Pax8Subscription[] = [];
  let page = 0;
  while (true) {
    const data = await pax8Get<{
      content: Pax8Subscription[];
      page: { totalPages: number };
    }>("/v1/subscriptions", { page, size: 200, status: "Active" });
    subs.push(...(data.content ?? []));
    if (page + 1 >= (data.page?.totalPages ?? 1)) break;
    page++;
  }
  return subs;
}

// ── Cost categorisation (ported from stratus-bot) ─────────────────────────────

const SKU_OVERRIDES: Record<string, string> = {
  "KEE-PER-MSP-C100": "Expensed Software",       // Keeper MSP
  "DRP-ARC-BAR-C100": "Expensed Software",       // Dropsuite / NinjaOne Backup
  "IRN-SCL-CPN-A100": "Expensed Software",       // Ironscales NFR (internal)
  "CGP-CMP-PGM-C100": "Managed Services Hard COGs",
  "WSB-STR-HMA-C100": "Expensed Software",       // Wasabi partner minimum
};

export const COST_CATEGORIES = [
  "Azure",
  "Microsoft 365 Monthly",
  "Microsoft 365 Annual",
  "Cybersecurity Resale",
  "Expensed Software",
  "Managed Services Hard COGs",
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

export function categorizeItem(item: Pax8InvoiceItem): string {
  const sku    = (item.sku ?? "").trim();
  const vendor = (item.vendorName ?? "").trim();
  const prod   = (item.productName ?? "").toLowerCase();
  const term   = (item.term ?? "").toLowerCase();

  if (SKU_OVERRIDES[sku]) return SKU_OVERRIDES[sku];
  if (prod.includes("azure") || sku.startsWith("MST-AZR")) return "Azure";
  if (vendor === "Microsoft")
    return term === "annual" ? "Microsoft 365 Annual" : "Microsoft 365 Monthly";
  return "Cybersecurity Resale";
}

// ── Summary builders ──────────────────────────────────────────────────────────

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

export type VendorRow    = { name: string; itemCount: number; cost: number; revenue: number };
export type CompanyRow   = { name: string; itemCount: number; cost: number; revenue: number };
export type CategoryRow  = { name: string; itemCount: number; cost: number };

export type InvoiceSummary = {
  totalCost: number;
  totalRevenue: number;
  margin: number;
  itemCount: number;
  companyCount: number;
  vendorCount: number;
  byVendor: VendorRow[];
  byCompany: CompanyRow[];
  byCategory: CategoryRow[];
};

export function buildInvoiceSummary(items: Pax8InvoiceItem[]): InvoiceSummary {
  const byVendor:   Record<string, VendorRow>   = {};
  const byCompany:  Record<string, CompanyRow>  = {};
  const byCategory: Record<string, CategoryRow> = {};
  let totalCost = 0;
  let totalRevenue = 0;

  for (const item of items) {
    const vendor   = item.vendorName   || "Unknown";
    const company  = item.companyName  || "Unknown";
    const category = categorizeItem(item);
    const cost     = item.costTotal ?? 0;
    const revenue  = item.total ?? 0;

    byVendor[vendor]   ??= { name: vendor,   itemCount: 0, cost: 0, revenue: 0 };
    byVendor[vendor].itemCount++;
    byVendor[vendor].cost    += cost;
    byVendor[vendor].revenue += revenue;

    byCompany[company] ??= { name: company,  itemCount: 0, cost: 0, revenue: 0 };
    byCompany[company].itemCount++;
    byCompany[company].cost    += cost;
    byCompany[company].revenue += revenue;

    byCategory[category] ??= { name: category, itemCount: 0, cost: 0 };
    byCategory[category].itemCount++;
    byCategory[category].cost += cost;

    totalCost    += cost;
    totalRevenue += revenue;
  }

  return {
    totalCost:    r2(totalCost),
    totalRevenue: r2(totalRevenue),
    margin:       r2(totalRevenue - totalCost),
    itemCount:    items.length,
    companyCount: Object.keys(byCompany).length,
    vendorCount:  Object.keys(byVendor).length,
    byVendor: Object.values(byVendor)
      .map((v) => ({ ...v, cost: r2(v.cost), revenue: r2(v.revenue) }))
      .sort((a, b) => b.revenue - a.revenue),
    byCompany: Object.values(byCompany)
      .map((v) => ({ ...v, cost: r2(v.cost), revenue: r2(v.revenue) }))
      .sort((a, b) => b.revenue - a.revenue),
    byCategory: COST_CATEGORIES.map((name) => {
      const v = byCategory[name] ?? { name, itemCount: 0, cost: 0 };
      return { ...v, cost: r2(v.cost) };
    }),
  };
}

// ── Estimated bill from active subscriptions ──────────────────────────────────

export type EstimatedLine = {
  productId: string;
  companyId: string;
  quantity: number;
  partnerCost: number;
  billingTerm: string;
  estimatedMonthly: number;
};

export type EstimatedBill = {
  lines: EstimatedLine[];
  totalEstimated: number;
  /** SKUs/products flagged as metered — cannot be estimated from subscriptions alone */
  meteredNote: string;
};

const METERED_SKU_PREFIXES = ["MST-AZR", "WSB-STR"];

// ── Current Bill Estimate (ported from Gravitron pax8_estimate.py) ────────────

const CBE_METERED_PREFIXES   = ["MST-AZR-"];
const CBE_METERED_SKUS       = new Set(["WSB-STR-HCS-C100", "WSB-STR-HMA-C100"]);
const CBE_API_BACKED_PREFIXES = ["IRN-", "CYB-", "DNS-", "AVA-"];
const CBE_INVOICE_ONLY_PREFIXES = ["KEE-", "SEN-"];

function cbeIsMetered(sku: string): boolean {
  return CBE_METERED_PREFIXES.some((p) => sku.startsWith(p))
    || CBE_INVOICE_ONLY_PREFIXES.some((p) => sku.startsWith(p))
    || CBE_METERED_SKUS.has(sku);
}
function cbeIsApiBacked(sku: string): boolean {
  return CBE_API_BACKED_PREFIXES.some((p) => sku.startsWith(p));
}

/** Proration factor for a sub starting mid-month. */
function cbeProrateNewSub(startDate: string, today: Date): number {
  if (!startDate) return 1.0;
  const start = new Date(startDate.slice(0, 10) + "T00:00:00Z");
  const yr = today.getUTCFullYear(), mo = today.getUTCMonth();
  if (start.getUTCFullYear() < yr || (start.getUTCFullYear() === yr && start.getUTCMonth() < mo)) return 1.0;
  if (start.getUTCFullYear() === yr && start.getUTCMonth() === mo) {
    const days = new Date(Date.UTC(yr, mo + 1, 0)).getUTCDate();
    return (days - start.getUTCDate() + 1) / days;
  }
  return 0.0;
}

/** Annual sub: does its billing cycle fall in the current month? */
function cbeBillsThisMonth(billingStart: string, today: Date): boolean {
  if (!billingStart) return false;
  const bs = new Date(billingStart.slice(0, 10) + "T00:00:00Z");
  return bs.getUTCFullYear() === today.getUTCFullYear() && bs.getUTCMonth() === today.getUTCMonth();
}

/** Fetch a single product's SKU / vendor / name by productId. */
async function cbeGetProduct(productId: string): Promise<{ sku: string; vendorName: string; name: string }> {
  try {
    const d = await pax8Get<{ sku?: string; vendorName?: string; name?: string }>(`/v1/products/${productId}`);
    return { sku: d.sku ?? "", vendorName: d.vendorName ?? "", name: d.name ?? "" };
  } catch { return { sku: "", vendorName: "", name: "" }; }
}

/** Fetch {companyId → name} for all companies. */
async function cbeListCompanies(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let page = 0;
  while (true) {
    const data = await pax8Get<{ content: Array<{ id: string; name?: string }>; page: { totalPages: number } }>(
      "/v1/companies", { page, size: 200 }
    );
    for (const c of data.content ?? []) { if (c.id) out.set(c.id, c.name ?? ""); }
    if (page + 1 >= (data.page?.totalPages ?? 1)) break;
    page++;
  }
  return out;
}

export type EstimateChange = {
  type: "new" | "cancelled" | "live_count" | "annual";
  description: string;
  cost: number;
};

export type EstimateBucket = {
  label: string;
  baseline: number;
  delta: number;
  total: number;
  itemCount: number;
  changes: EstimateChange[];
};

export type CurrentBillEstimate = {
  asOfDate: string;
  baselineInvoiceId: string;
  baselineInvoiceDate: string;
  grandTotal: number;
  buckets: EstimateBucket[];
  assumptions: {
    baselineTotal: number;
    deltaTotal: number;
    newSubsAdded: number;
    cancelledSubsRemoved: number;
    ironscalesLiveCount: number | null;
    azureNote: string;
  };
};

const CBE_BUCKET_ORDER = [
  "Azure",
  "Microsoft 365 Monthly",
  "Microsoft 365 Annual",
  "Cybersecurity Resale",
  "Expensed Software",
  "Managed Services Hard COGs",
] as const;

/**
 * Build a current-month Pax8 bill estimate.
 *
 * Algorithm (ported from Gravitron pax8_estimate.py):
 *   1. Baseline = last invoice items, grouped by cost-accounting bucket
 *      (Azure & M365 Annual excluded from baseline per Gravitron spec)
 *   2. New subs (not on last invoice): add qty × partnerCost × proration
 *   3. Annual subs whose billingStart falls this month: add full cost
 *   4. Cancelled subs (on last invoice, no longer active): subtract cost
 *   5. Ironscales live counts (IRN-): replace invoice qty with live count
 *      using invoice-derived unit cost, net delta → Cybersecurity Resale
 *   6. Azure: last invoice total carried forward (no 3-month DB average)
 */
export async function buildCurrentBillEstimate(): Promise<CurrentBillEstimate> {
  const today = new Date();

  // 1. Last invoice → baseline
  const invoices = await listInvoices(1);
  if (!invoices.length) throw new Pax8Error("No Pax8 invoices found to use as baseline", 404);
  const lastInv = invoices[0];
  const items   = await getInvoiceItems(lastInv.id);

  const baselineBuckets: Record<string, { cost: number; itemCount: number }> = {};
  const bySubId  = new Map<string, { category: string; cost: number; qty: number; sku: string; productName: string }>();
  const apiQty   : Record<string, number> = {};
  const apiCost  : Record<string, number> = {};
  let azureBaseline = 0;

  for (const item of items) {
    const sku = (item.sku ?? "").trim();
    const cat = categorizeItem(item);
    const cost = item.costTotal ?? 0;
    const qty  = item.quantity  ?? 0;

    if (cat === "Azure") { azureBaseline += cost; continue; }
    if (cat === "Microsoft 365 Annual") continue; // annual handled from live subs

    baselineBuckets[cat] ??= { cost: 0, itemCount: 0 };
    baselineBuckets[cat].cost += cost;
    baselineBuckets[cat].itemCount++;

    if (item.subscriptionId) {
      bySubId.set(item.subscriptionId, { category: cat, cost, qty, sku, productName: item.productName ?? "" });
    }
    if (cbeIsApiBacked(sku) && qty > 0) {
      apiQty[sku]  = (apiQty[sku]  ?? 0) + qty;
      apiCost[sku] = (apiCost[sku] ?? 0) + cost;
    }
  }

  // 2. Active subs — detect new / annual / cancelled
  const activeSubs = await listActiveSubscriptions();
  const liveSubIds = new Set(activeSubs.map((s) => s.id));

  // Fetch product info for new subs in parallel (typically few per month)
  const newSubs = activeSubs.filter((s) => !bySubId.has(s.id));
  const annualSubs = activeSubs.filter(
    (s) => (s.billingTerm ?? "").toLowerCase() === "annual" && cbeBillsThisMonth(s.billingStart ?? "", today)
  );
  const needLookup = new Map<string, ReturnType<typeof cbeGetProduct>>();
  for (const s of [...newSubs, ...annualSubs]) {
    if (!needLookup.has(s.productId)) needLookup.set(s.productId, cbeGetProduct(s.productId));
  }
  const productMap = new Map<string, { sku: string; vendorName: string; name: string }>();
  await Promise.all(
    [...needLookup.entries()].map(async ([pid, p]) => productMap.set(pid, await p))
  );

  // Company names for display — only if we have new/annual subs
  let companyMap = new Map<string, string>();
  const needCompanyIds = new Set([...newSubs, ...annualSubs].map((s) => s.companyId ?? "").filter(Boolean));
  if (needCompanyIds.size > 0) {
    try { companyMap = await cbeListCompanies(); } catch { /* best-effort */ }
  }

  // Accumulate deltas
  const deltas: Record<string, { cost: number; itemCount: number; changes: EstimateChange[] }> = {};
  function addDelta(cat: string, cost: number, change: EstimateChange) {
    deltas[cat] ??= { cost: 0, itemCount: 0, changes: [] };
    deltas[cat].cost += cost;
    deltas[cat].itemCount += cost >= 0 ? 1 : -1;
    deltas[cat].changes.push(change);
  }

  // 2a. Annual subs billing this month
  for (const sub of annualSubs) {
    const prod = productMap.get(sub.productId) ?? { sku: "", vendorName: "", name: "" };
    const cost = r2((sub.quantity ?? 0) * (sub.partnerCost ?? 0));
    const cat  = prod.sku
      ? categorizeItem({ id: sub.id, sku: prod.sku, vendorName: prod.vendorName, productName: prod.name, term: "Annual" })
      : "Microsoft 365 Annual";
    if (cat === "Azure") continue;
    const co = companyMap.get(sub.companyId ?? "") || sub.companyId || "Unknown";
    addDelta(cat, cost, { type: "annual", description: `[ANNUAL] ${co} — ${prod.name || prod.sku || sub.productId}`, cost });
  }

  // 2b. New monthly subs (not on last invoice, not annual)
  for (const sub of newSubs) {
    if ((sub.billingTerm ?? "").toLowerCase() === "annual") continue; // handled above
    const proration = cbeProrateNewSub(sub.startDate ?? "", today);
    if (proration === 0) continue;
    const prod = productMap.get(sub.productId) ?? { sku: "", vendorName: "", name: "" };
    const cost = r2((sub.quantity ?? 0) * (sub.partnerCost ?? 0) * proration);
    const cat  = prod.sku
      ? categorizeItem({ id: sub.id, sku: prod.sku, vendorName: prod.vendorName, productName: prod.name, term: sub.billingTerm ?? "" })
      : "Cybersecurity Resale";
    if (cat === "Azure") continue;
    const co   = companyMap.get(sub.companyId ?? "") || sub.companyId || "Unknown";
    const tag  = proration < 1 ? `[NEW, ${Math.round(proration * 100)}% prorated]` : "[NEW]";
    addDelta(cat, cost, { type: "new", description: `${tag} ${co} — ${prod.name || prod.sku || sub.productId}`, cost });
  }

  // 2c. Cancelled subs (on last invoice but no longer active)
  for (const [subId, info] of bySubId) {
    if (liveSubIds.has(subId)) continue;
    if (cbeIsApiBacked(info.sku)) continue; // handled by live-count delta
    addDelta(info.category, -info.cost, {
      type: "cancelled",
      description: `[CANCELLED] ${info.productName || info.sku}`,
      cost: -info.cost,
    });
  }

  // 3. Ironscales live-count delta (IRN- SKUs)
  let ironscalesLiveCount: number | null = null;
  try {
    const { getAllCompanyStats } = await import("./ironscales");
    const stats = await getAllCompanyStats();
    const liveTotal = stats.reduce((s, c) => s + (c.protectedMailboxes ?? 0), 0);
    ironscalesLiveCount = liveTotal;

    let invIrnQty = 0, invIrnCost = 0;
    for (const [sku, qty] of Object.entries(apiQty)) {
      if (sku.startsWith("IRN-")) { invIrnQty += qty; invIrnCost += (apiCost[sku] ?? 0); }
    }
    if (invIrnQty > 0 && liveTotal > 0) {
      const unitCost = invIrnCost / invIrnQty;
      const newCost  = r2(liveTotal * unitCost);
      const delta    = r2(newCost - invIrnCost);
      if (delta !== 0) {
        addDelta("Cybersecurity Resale", delta, {
          type: "live_count",
          description: `[LIVE] Ironscales: ${liveTotal} seats × $${unitCost.toFixed(4)} = $${newCost.toFixed(2)} (was $${invIrnCost.toFixed(2)})`,
          cost: delta,
        });
      }
    }
  } catch { /* Ironscales not configured — continue without */ }

  // 4. Assemble final buckets
  const buckets: EstimateBucket[] = CBE_BUCKET_ORDER.map((label) => {
    if (label === "Azure") {
      return { label, baseline: r2(azureBaseline), delta: 0, total: r2(azureBaseline), itemCount: 0, changes: [] };
    }
    const base  = baselineBuckets[label] ?? { cost: 0, itemCount: 0 };
    const delta = deltas[label]          ?? { cost: 0, itemCount: 0, changes: [] };
    return {
      label,
      baseline:  r2(base.cost),
      delta:     r2(delta.cost),
      total:     r2(base.cost + delta.cost),
      itemCount: base.itemCount + delta.itemCount,
      changes:   delta.changes,
    };
  });

  const grandTotal    = r2(buckets.reduce((s, b) => s + b.total, 0));
  const baselineTotal = r2(Object.values(baselineBuckets).reduce((s, b) => s + b.cost, 0) + azureBaseline);
  const deltaTotal    = r2(Object.values(deltas).reduce((s, d) => s + d.cost, 0));
  const allChanges    = Object.values(deltas).flatMap((d) => d.changes);

  return {
    asOfDate:            today.toISOString().slice(0, 10),
    baselineInvoiceId:   lastInv.id,
    baselineInvoiceDate: lastInv.invoiceDate,
    grandTotal,
    buckets,
    assumptions: {
      baselineTotal,
      deltaTotal,
      newSubsAdded:          allChanges.filter((c) => c.type === "new" || c.type === "annual").length,
      cancelledSubsRemoved:  allChanges.filter((c) => c.type === "cancelled").length,
      ironscalesLiveCount,
      azureNote: "Azure uses last invoice total — actual charges vary by consumption.",
    },
  };
}

/**
 * Compute an estimated monthly bill from active subscriptions.
 * Annual subs are divided by 12. Metered products (Azure, Wasabi) are excluded
 * since their actual cost depends on usage, not a fixed per-seat price.
 */
export function buildEstimatedBill(subs: Pax8Subscription[]): EstimatedBill {
  const lines: EstimatedLine[] = [];
  let total = 0;
  let hasMetered = false;

  for (const sub of subs) {
    const sku = sub.productId ?? "";
    if (METERED_SKU_PREFIXES.some((p) => sku.startsWith(p))) {
      hasMetered = true;
      continue;
    }
    const partnerCost = sub.partnerCost ?? 0;
    const quantity    = sub.quantity ?? 1;
    const term        = (sub.billingTerm ?? "").toLowerCase();
    const monthly     = term === "annual"
      ? r2((partnerCost * quantity) / 12)
      : r2(partnerCost * quantity);

    lines.push({
      productId:        sub.productId,
      companyId:        sub.companyId ?? "",
      quantity,
      partnerCost,
      billingTerm:      sub.billingTerm ?? "",
      estimatedMonthly: monthly,
    });
    total += monthly;
  }

  return {
    lines,
    totalEstimated: r2(total),
    meteredNote: hasMetered
      ? "Azure and Wasabi usage charges are excluded — metered costs vary by consumption."
      : "",
  };
}
