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
