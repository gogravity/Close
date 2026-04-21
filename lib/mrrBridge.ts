import "server-only";
import {
  listGlEntriesRange,
  listSalesInvoices,
  listSalesCreditMemos,
} from "./businessCentral";
import {
  listInvoices,
  listAgreementAdditions,
  listProcurementCatalog,
  listAllCompanyNames,
  type CwInvoice,
  type CwAgreementAddition,
} from "./connectwise";
import { listClosedWonDeals, calculateDealMrr } from "./hubspot";

// ---------------------------------------------------------------------------
// MRR Bridge
//
// Port of the Python prototype at docs/BCS_mrr_bridge (see zip). BC GL entries
// on the MRR accounts are the source of truth for dollar amounts; CW invoices
// + BC sales invoices + BC credit memos + JE-description parsing resolve each
// GL document number back to a customer + agreement.
//
// Classification lives at the *customer* level (not the agreement level), so
// a customer with one agreement dropped and another added on the same month
// nets to an upsell/downsell, not churn + new_client.
//
// Category definitions (per Lyra/MSP standard):
//   new_acquisition_beginning  Opening balance MRR for newly acquired opcos
//   fx_adjustment              FX rate change adjustments (foreign currency opcos)
//   one_time_adj               Unusual one-off items (double billing, etc) — manual only
//   recurring_licenses         Large annual licenses not yet reclassified — manual only
//   new_client                 Completely new logo with no prior MRR history
//   price_increase             Same-service price up for existing client
//   upsell                     Existing client adds new or more services (qty up)
//   price_decrease             Same-service price down for existing client
//   downsell                   Existing client drops some services, remains a client
//   churn                      Client terminates ALL services
//   flat                       No net change
// ---------------------------------------------------------------------------

const MRR_ACCOUNTS = [
  "400010", // Managed IT Services
  "402010", // Recurring Cloud Resale
  "402030", // Recurring Cybersecurity Resale
  "402040", // Recurring VOIP & Connectivity Resale
  "402050", // Recurring HaaS / Private Hosting
];

const CLOUD_SUBCATEGORIES = new Set(["365 Monthly", "365 Annual", "Azure"]);

const CUSTOMER_ALIASES: Record<string, string> = {
  "lyra communications": "Telco Experts",
  "telco experts": "Telco Experts",
  "telarus": "Telarus",
};

export type MrrBridgeInput = {
  priorStart: string;
  priorEnd: string;
  currentStart: string;
  currentEnd: string;
  priorSignedNotOnboarded?: number;
  skipHubspot?: boolean;
};

export type BridgeLineCategory =
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

export type BridgeLine = {
  rowId: string;
  company: string;
  agreement: string;
  agreementId: number | null;
  priorMrr: number;
  currentMrr: number;
  change: number;
  category: BridgeLineCategory;
  products?: ProductChange[];
  priceIncreaseAmount?: number;
  priceDecreaseAmount?: number;
};

export type BridgeCustomer = {
  customerId: string;
  customerName: string;
  priorMrr: number;
  currentMrr: number;
  change: number;
  category: BridgeLineCategory;
  agreements: BridgeLine[];
};

export type SignedDeal = {
  dealName: string;
  company: string;
  mrr: number;
  closeDate: string;
};

export type MrrBridgeResult = {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function monthLabel(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

/** Strip parenthetical suffixes so "Preferred Rate (American Pacific)" and
 *  "Preferred Rate (Margo)" consolidate to "Preferred Rate". */
function normalizeCompany(name: string): string {
  const base = name.replace(/\s*\(.*\)\s*$/, "").trim();
  return base || name;
}

function canonicalizeCustomer(name: string): string {
  const key = name.toLowerCase().trim();
  return CUSTOMER_ALIASES[key] ?? name;
}

function extractJeCustomer(description: string): string {
  const desc = (description ?? "").trim();
  if (/^Adjusting Deferred Charge/i.test(desc)) return "";
  const achMatch = /COMPANY NAME:\s*([^\s]+(?:\s+[^\s]+)*?)\s{2,}/.exec(desc);
  if (achMatch) {
    return canonicalizeCustomer(achMatch[1].trim().replace(/,$/, "").trim());
  }
  if (desc.includes(",") && !desc.includes("Invoice")) {
    return canonicalizeCustomer(desc.split(",")[0].trim());
  }
  if (desc.includes(" - Invoice")) {
    return canonicalizeCustomer(desc.split(" - Invoice")[0].trim());
  }
  if (desc === desc.toUpperCase() && /[A-Z]/.test(desc)) {
    const titled = desc
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
    return canonicalizeCustomer(titled);
  }
  return canonicalizeCustomer(desc);
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

type GlRow = {
  documentNumber: string;
  description: string;
  net: number;
};

async function fetchGlEntries(start: string, end: string): Promise<GlRow[]> {
  const entries = await listGlEntriesRange(start, end, MRR_ACCOUNTS);
  return entries.map((e) => ({
    documentNumber: e.documentNumber ?? "",
    description: e.description ?? "",
    net: (e.creditAmount ?? 0) - (e.debitAmount ?? 0),
  }));
}

type CwInvoiceInfo = {
  company: string;
  agreement: string;
  agreementId: number | null;
};

function buildCwInvoiceMap(invoices: CwInvoice[]): Map<string, CwInvoiceInfo> {
  const out = new Map<string, CwInvoiceInfo>();
  for (const inv of invoices) {
    if (!inv.invoiceNumber) continue;
    out.set(inv.invoiceNumber, {
      company: inv.company?.name ?? "Unknown",
      agreement: inv.agreement?.name ?? "",
      agreementId: inv.agreement?.id ?? null,
    });
  }
  return out;
}

async function fetchCwInvoiceMap(start: string, end: string): Promise<Map<string, CwInvoiceInfo>> {
  const invoices = await listInvoices(shiftDate(start, -7), shiftDate(end, 7));
  return buildCwInvoiceMap(invoices);
}

async function fetchDgCustomerMap(start: string, end: string): Promise<Map<string, string>> {
  const invoices = await listSalesInvoices(start, end);
  const out = new Map<string, string>();
  for (const inv of invoices) {
    if (!inv.number || !inv.number.startsWith("DG-")) continue;
    if (inv.customerName) out.set(inv.number, inv.customerName);
  }
  return out;
}

type ScmInfo = {
  customerName: string;
  appliedToInvoice: string;
};

async function fetchScmCustomerMap(start: string, end: string): Promise<Map<string, ScmInfo>> {
  const buf = 7;
  const memos = await listSalesCreditMemos(shiftDate(start, -buf), shiftDate(end, buf));
  const out = new Map<string, ScmInfo>();
  const ZERO_GUID = "00000000-0000-0000-0000-000000000000";
  for (const m of memos) {
    if (!m.number) continue;
    const linkedInvoice =
      typeof m.invoiceNumber === "string" &&
      m.invoiceNumber.length > 0 &&
      m.invoiceId !== ZERO_GUID
        ? m.invoiceNumber
        : "";
    out.set(m.number, { customerName: m.customerName ?? "", appliedToInvoice: linkedInvoice });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Agreement addition snapshots
// ---------------------------------------------------------------------------

type AdditionSnapshotEntry = {
  unitPrice: number;
  quantity: number;
  total: number;
  subcategory: string;
};

function snapshotOnDate(
  additions: CwAgreementAddition[],
  asOf: string,
  productSubcat: Map<string, string>
): Map<string, AdditionSnapshotEntry> {
  const byProduct = new Map<string, AdditionSnapshotEntry>();
  for (const a of additions) {
    if (a.billCustomer !== "Billable") continue;
    const eff = a.effectiveDate ? a.effectiveDate.slice(0, 10) : null;
    const cancel = a.cancelledDate ? a.cancelledDate.slice(0, 10) : null;
    const effActive = !eff || eff <= asOf;
    const notCancelled = !cancel || cancel >= asOf;
    if (!(effActive && notCancelled)) continue;
    const prodId = a.product?.identifier ?? "N/A";
    const subcat = productSubcat.get(prodId) ?? "";
    const existing = byProduct.get(prodId);
    if (existing) {
      existing.quantity += a.quantity;
      existing.total += a.quantity * a.unitPrice;
    } else {
      byProduct.set(prodId, {
        unitPrice: a.unitPrice,
        quantity: a.quantity,
        total: a.quantity * a.unitPrice,
        subcategory: subcat,
      });
    }
  }
  return byProduct;
}

type LineItemBreakdown = {
  priceIncrease: number;
  priceDecrease: number; // negative value (price went down, same qty)
  upsell: number;
  downsell: number;
  products: ProductChange[];
};

export type ProductChange = {
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
    | "price_decrease"
    | "upsell"
    | "downsell"
    | "flat";
};

async function classifyAgreementLineItems(
  agreementIds: Set<number>,
  priorDate: string,
  currentDate: string
): Promise<Map<number, LineItemBreakdown>> {
  const catalog = await listProcurementCatalog();
  const productSubcat = new Map<string, string>();
  for (const p of catalog) {
    if (p.identifier) productSubcat.set(p.identifier, p.subcategory?.name ?? "");
  }

  const out = new Map<number, LineItemBreakdown>();
  for (const agrId of agreementIds) {
    const additions = await listAgreementAdditions(agrId);
    const prior = snapshotOnDate(additions, priorDate, productSubcat);
    const current = snapshotOnDate(additions, currentDate, productSubcat);
    const bd: LineItemBreakdown = { priceIncrease: 0, priceDecrease: 0, upsell: 0, downsell: 0, products: [] };
    const allProducts = new Set<string>([...prior.keys(), ...current.keys()]);
    for (const prod of allProducts) {
      const pri = prior.get(prod);
      const cur = current.get(prod);
      const subcat = cur?.subcategory || pri?.subcategory || "";
      let pc: ProductChange = {
        productId: prod,
        subcategory: subcat,
        priorQuantity: pri?.quantity ?? 0,
        currentQuantity: cur?.quantity ?? 0,
        priorUnitPrice: pri?.unitPrice ?? 0,
        currentUnitPrice: cur?.unitPrice ?? 0,
        priorTotal: round2(pri?.total ?? 0),
        currentTotal: round2(cur?.total ?? 0),
        change: round2((cur?.total ?? 0) - (pri?.total ?? 0)),
        category: "flat",
      };
      if (cur && !pri) {
        // Brand new product added to the agreement → upsell (new service)
        bd.upsell += cur.total;
        pc = { ...pc, category: "new_product" };
      } else if (pri && !cur) {
        // Product removed from agreement
        bd.downsell -= pri.total;
        pc = { ...pc, category: "removed_product" };
      } else if (cur && pri) {
        const delta = cur.total - pri.total;
        if (Math.abs(delta) < 0.005) continue; // flat — skip
        const isCloud = CLOUD_SUBCATEGORIES.has(subcat);
        const sameQty = cur.quantity === pri.quantity;
        const priceUp = cur.unitPrice > pri.unitPrice;
        const priceDown = cur.unitPrice < pri.unitPrice;

        if (isCloud) {
          // Cloud: qty changes mean seat add/remove; price-only changes are
          // price increase/decrease even for cloud products.
          if (sameQty && priceUp) {
            bd.priceIncrease += delta;
            pc = { ...pc, category: "price_increase" };
          } else if (sameQty && priceDown) {
            bd.priceDecrease += delta; // delta is negative
            pc = { ...pc, category: "price_decrease" };
          } else if (delta > 0) {
            bd.upsell += delta;
            pc = { ...pc, category: "upsell" };
          } else {
            bd.downsell += delta;
            pc = { ...pc, category: "downsell" };
          }
        } else if (sameQty && priceUp) {
          // Same quantity, unit price went up → price increase per Lyra definition
          bd.priceIncrease += delta;
          pc = { ...pc, category: "price_increase" };
        } else if (sameQty && priceDown) {
          // Same quantity, unit price went down → price decrease per Lyra definition
          bd.priceDecrease += delta; // delta is negative
          pc = { ...pc, category: "price_decrease" };
        } else if (delta > 0) {
          // Quantity increased → upsell (existing client, more services/qty)
          bd.upsell += delta;
          pc = { ...pc, category: "upsell" };
        } else {
          // Quantity decreased but client still has the agreement → downsell
          bd.downsell += delta;
          pc = { ...pc, category: "downsell" };
        }
      }
      bd.products.push(pc);
    }
    bd.products.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    out.set(agrId, bd);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

type TotalsResult = {
  totals: Map<string, number>;
  agreementIds: Map<string, number | null>;
};

function buildAgreementTotals(
  glRows: GlRow[],
  cwMap: Map<string, CwInvoiceInfo>,
  dgMap: Map<string, string>,
  scmMap: Map<string, ScmInfo>
): TotalsResult {
  if (glRows.length === 0) {
    return { totals: new Map(), agreementIds: new Map() };
  }

  const rowsByDoc = new Map<string, GlRow[]>();
  for (const r of glRows) {
    const arr = rowsByDoc.get(r.documentNumber);
    if (arr) arr.push(r);
    else rowsByDoc.set(r.documentNumber, [r]);
  }

  const filtered: GlRow[] = [];
  for (const [doc, rows] of rowsByDoc.entries()) {
    if (doc.startsWith("GJ-")) {
      const hasDeferred = rows.some((r) => /Adjusting Deferred/i.test(r.description));
      if (hasDeferred) {
        for (const r of rows) {
          if (/Adjusting Deferred/i.test(r.description)) filtered.push(r);
        }
      } else {
        for (const r of rows) filtered.push(r);
      }
    } else {
      for (const r of rows) filtered.push(r);
    }
  }

  const docDescriptions = new Map<string, string>();
  for (const [doc, rows] of rowsByDoc.entries()) {
    const deferred = rows.find((r) => /Adjusting Deferred/i.test(r.description));
    if (deferred) {
      docDescriptions.set(doc, deferred.description);
    } else {
      const best = [...rows].sort((a, b) => Math.abs(b.net) - Math.abs(a.net))[0];
      docDescriptions.set(doc, best?.description ?? "");
    }
  }

  const netByDoc = new Map<string, number>();
  for (const r of filtered) {
    netByDoc.set(r.documentNumber, (netByDoc.get(r.documentNumber) ?? 0) + r.net);
  }

  const totals = new Map<string, number>();
  const agreementIds = new Map<string, number | null>();
  const encode = (company: string, agreement: string) => `${company}||${agreement}`;

  for (const [docNum, net] of netByDoc.entries()) {
    let company = "Other";
    let agreement = docNum;
    let agrId: number | null = null;
    const info = cwMap.get(docNum);
    if (info) {
      company = info.company;
      agreement = info.agreement;
      agrId = info.agreementId;
    } else if (docNum.startsWith("DG-")) {
      company = dgMap.get(docNum) ?? "Unknown DG Customer";
      agreement = "VoIP & Telecom (Datagate)";
    } else if (docNum.startsWith("GJ-")) {
      const desc = docDescriptions.get(docNum) ?? "";
      if (/Adjusting Deferred/i.test(desc)) {
        company = "Deferred Revenue Adjustment";
        agreement = "Monthly Deferred Charge Recognition";
      } else {
        const customer = extractJeCustomer(desc);
        if (customer) {
          company = customer;
          agreement = "Non-CW Billing (Journal Entry)";
        } else {
          company = "Journal Entry";
          agreement = docNum;
        }
      }
    } else if (docNum.startsWith("SCM-")) {
      const scm = scmMap.get(docNum);
      const linkedInvoiceInfo =
        scm?.appliedToInvoice && scm.appliedToInvoice.length > 0
          ? cwMap.get(scm.appliedToInvoice)
          : undefined;
      if (linkedInvoiceInfo) {
        company = linkedInvoiceInfo.company;
        agreement = linkedInvoiceInfo.agreement;
        agrId = linkedInvoiceInfo.agreementId;
      } else if (scm?.customerName) {
        company = scm.customerName;
        agreement = "Credit Memo Adjustment";
      } else {
        const desc = docDescriptions.get(docNum) ?? "";
        company = "Credit Memo";
        agreement = `${docNum} - ${desc}`;
      }
    }
    const key = encode(company, agreement);
    totals.set(key, (totals.get(key) ?? 0) + net);
    if (!agreementIds.has(key)) agreementIds.set(key, agrId);
  }

  return { totals, agreementIds };
}

function consolidateTotals(t: TotalsResult): TotalsResult {
  const newTotals = new Map<string, number>();
  const newIds = new Map<string, number | null>();
  for (const [key, amount] of t.totals.entries()) {
    const [company, agreement] = key.split("||");
    const nkey = `${normalizeCompany(company)}||${agreement}`;
    newTotals.set(nkey, (newTotals.get(nkey) ?? 0) + amount);
    if (!newIds.has(nkey)) newIds.set(nkey, t.agreementIds.get(key) ?? null);
  }
  return { totals: newTotals, agreementIds: newIds };
}

/**
 * Roll up per-agreement bridge lines into per-customer rows.
 *
 * Category precedence (most specific wins):
 *  1. new_client  — customer had zero prior MRR and a new_client agreement
 *  2. churn       — customer has zero current MRR and a churn agreement
 *  3. price_increase — all agreements are price_increase
 *  4. price_decrease — all agreements are price_decrease
 *  5. price_increase by amount — net change ≈ sum of price-increase deltas
 *  6. price_decrease by amount — net change ≈ sum of price-decrease deltas
 *  7. upsell / downsell / flat — sign of net change
 */
function groupByCustomer(
  lines: BridgeLine[],
  priorByCompany: Map<string, number>,
  currentByCompany: Map<string, number>
): BridgeCustomer[] {
  const byCompany = new Map<string, BridgeLine[]>();
  for (const l of lines) {
    const arr = byCompany.get(l.company);
    if (arr) arr.push(l);
    else byCompany.set(l.company, [l]);
  }

  const out: BridgeCustomer[] = [];
  for (const [company, agreements] of byCompany.entries()) {
    const priorMrr = round2(priorByCompany.get(company) ?? 0);
    const currentMrr = round2(currentByCompany.get(company) ?? 0);
    const change = round2(currentMrr - priorMrr);

    let category: BridgeLineCategory = "flat";
    const cats = new Set(agreements.map((a) => a.category));

    if (priorMrr <= 0.005 && currentMrr > 0 && cats.has("new_client")) {
      // Completely new logo — no prior MRR at all
      category = "new_client";
    } else if (currentMrr <= 0.005 && priorMrr > 0 && cats.has("churn")) {
      // All services terminated
      category = "churn";
    } else if (cats.size === 1 && cats.has("price_increase")) {
      category = "price_increase";
    } else if (cats.size === 1 && cats.has("price_decrease")) {
      category = "price_decrease";
    } else {
      // Amount-based fallbacks: if essentially all the movement is
      // price_increase or price_decrease, classify accordingly.
      const totalPriceIncrease = agreements.reduce((s, a) => s + (a.priceIncreaseAmount ?? 0), 0);
      const totalPriceDecrease = agreements.reduce((s, a) => s + (a.priceDecreaseAmount ?? 0), 0);

      if (change > 0 && totalPriceIncrease > 0 && Math.abs(change - totalPriceIncrease) < 1) {
        // Net positive movement explained entirely by price increases
        category = "price_increase";
      } else if (change < 0 && totalPriceDecrease < 0 && Math.abs(change - totalPriceDecrease) < 1) {
        // Net negative movement explained entirely by price decreases
        category = "price_decrease";
      } else if (Math.abs(change) <= 0.005) {
        category = "flat";
      } else if (change > 0) {
        // Positive net: existing client added services/qty
        category = "upsell";
      } else {
        // Negative net: existing client dropped some services but not all
        category = "downsell";
      }
    }

    agreements.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    out.push({
      customerId: company,
      customerName: company,
      priorMrr,
      currentMrr,
      change,
      category,
      agreements,
    });
  }
  out.sort((a, b) => a.change - b.change);
  return out;
}

// ---------------------------------------------------------------------------
// 12-month historical-customer lookup
// ---------------------------------------------------------------------------

async function fetchHistoricalCustomers(
  lookbackStart: string,
  lookbackEnd: string
): Promise<Set<string>> {
  const out = new Set<string>();
  const invoices = await listSalesInvoices(lookbackStart, lookbackEnd);
  for (const inv of invoices) {
    const n = (inv.customerName ?? "").trim();
    if (n) out.add(normalizeCompany(n));
  }
  const gl = await listGlEntriesRange(lookbackStart, lookbackEnd, MRR_ACCOUNTS);
  for (const e of gl) {
    if (!e.documentNumber?.startsWith("GJ-")) continue;
    const customer = extractJeCustomer(e.description ?? "");
    if (customer) out.add(normalizeCompany(customer));
  }
  const cwNames = await listAllCompanyNames();
  for (const n of cwNames) {
    out.add(normalizeCompany(canonicalizeCustomer(n)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bridge computation
// ---------------------------------------------------------------------------

export async function computeMrrBridge(input: MrrBridgeInput): Promise<MrrBridgeResult> {
  const {
    priorStart, priorEnd, currentStart, currentEnd,
    priorSignedNotOnboarded = 0,
    skipHubspot = false,
  } = input;

  const [
    priorGl, currentGl,
    priorCwMap, currentCwMap,
    priorDgMap, currentDgMap,
    priorScmMap, currentScmMap,
  ] = await Promise.all([
    fetchGlEntries(priorStart, priorEnd),
    fetchGlEntries(currentStart, currentEnd),
    fetchCwInvoiceMap(priorStart, priorEnd),
    fetchCwInvoiceMap(currentStart, currentEnd),
    fetchDgCustomerMap(priorStart, priorEnd),
    fetchDgCustomerMap(currentStart, currentEnd),
    fetchScmCustomerMap(priorStart, priorEnd),
    fetchScmCustomerMap(currentStart, currentEnd),
  ]);

  const prior = consolidateTotals(buildAgreementTotals(priorGl, priorCwMap, priorDgMap, priorScmMap));
  const current = consolidateTotals(buildAgreementTotals(currentGl, currentCwMap, currentDgMap, currentScmMap));

  // Build bridge lines for keys where the amount changed.
  const allKeys = new Set<string>([...prior.totals.keys(), ...current.totals.keys()]);
  const lines: BridgeLine[] = [];
  for (const key of allKeys) {
    const priorVal = round2(prior.totals.get(key) ?? 0);
    const currentVal = round2(current.totals.get(key) ?? 0);
    if (Math.abs(currentVal - priorVal) <= 0.005) continue;
    const [company, agreement] = key.split("||");
    const change = round2(currentVal - priorVal);

    // Initial classification — refined below after customer totals and
    // product-level breakdown are available.
    let category: BridgeLineCategory = "flat";
    if (agreement === "Credit Memo Adjustment") {
      // Credit memos are one-off adjustments by definition — default to
      // one_time_adj so they don't inflate churn/downsell stats.
      category = "one_time_adj";
    } else if (priorVal === 0 && currentVal > 0) category = "new_client";
    else if (change > 0) category = "upsell";
    else if (change < 0) category = "downsell";

    const agreementId = current.agreementIds.get(key) ?? prior.agreementIds.get(key) ?? null;
    lines.push({ rowId: `${company}||${agreement}`, company, agreement, agreementId, priorMrr: priorVal, currentMrr: currentVal, change, category });
  }

  // Customer-level totals for churn / new_client refinement.
  const priorByCompany = new Map<string, number>();
  const currentByCompany = new Map<string, number>();
  for (const [key, val] of prior.totals.entries()) {
    const company = key.split("||")[0];
    priorByCompany.set(company, (priorByCompany.get(company) ?? 0) + val);
  }
  for (const [key, val] of current.totals.entries()) {
    const company = key.split("||")[0];
    currentByCompany.set(company, (currentByCompany.get(company) ?? 0) + val);
  }

  for (const line of lines) {
    if (line.category === "one_time_adj") continue; // don't override manual defaults
    const priorCust = priorByCompany.get(line.company) ?? 0;
    const currentCust = currentByCompany.get(line.company) ?? 0;
    if (line.priorMrr > 0 && line.currentMrr === 0) {
      // Agreement went to zero — churn only if entire customer went to zero
      line.category = currentCust > 0 ? "downsell" : "churn";
    } else if (line.priorMrr === 0 && line.currentMrr > 0) {
      // Agreement appeared — new_client only if customer was completely new
      line.category = priorCust > 0 ? "upsell" : "new_client";
    }
  }

  // 12-month lookback: flip provisional new_client → upsell if customer existed.
  const provisionalNewClients = lines.filter((l) => l.category === "new_client");
  if (provisionalNewClients.length > 0) {
    const lookbackStart = shiftDate(priorStart, -365);
    const lookbackEnd = shiftDate(priorStart, -1);
    const historical = await fetchHistoricalCustomers(lookbackStart, lookbackEnd);
    for (const line of provisionalNewClients) {
      const canon = normalizeCompany(canonicalizeCustomer(line.company));
      if (historical.has(canon)) line.category = "upsell";
    }
  }

  // Product-level breakdown for all agreement-backed lines. Drives:
  //   • expand view product detail
  //   • price_increase vs upsell preset
  //   • price_decrease vs downsell preset
  const agrIdsToCheck = new Set<number>();
  for (const l of lines) {
    if (l.agreementId != null) agrIdsToCheck.add(l.agreementId);
  }
  if (agrIdsToCheck.size > 0) {
    const breakdowns = await classifyAgreementLineItems(agrIdsToCheck, priorEnd, currentEnd);
    for (const l of lines) {
      if (l.agreementId == null) continue;
      const bd = breakdowns.get(l.agreementId);
      if (!bd) continue;
      l.products = bd.products;
      l.priceIncreaseAmount = round2(bd.priceIncrease);
      l.priceDecreaseAmount = round2(bd.priceDecrease); // negative

      const totalAbs = Math.abs(bd.priceIncrease) + Math.abs(bd.priceDecrease) + Math.abs(bd.upsell) + Math.abs(bd.downsell);

      if (
        l.category === "upsell" &&
        bd.priceIncrease > 0 &&
        Math.abs(totalAbs - Math.abs(bd.priceIncrease)) < 1
      ) {
        // Agreement's entire positive movement is price-only (same qty, price up)
        l.category = "price_increase";
      } else if (
        l.category === "downsell" &&
        bd.priceDecrease < 0 &&
        Math.abs(totalAbs - Math.abs(bd.priceDecrease)) < 1
      ) {
        // Agreement's entire negative movement is price-only (same qty, price down)
        // Per Lyra definition: price decrease to existing client
        l.category = "price_decrease";
      }
    }
  }

  lines.sort((a, b) => a.change - b.change);

  const customers = groupByCustomer(lines, priorByCompany, currentByCompany);

  // Summary totals over customer-level categories.
  const beginningMrr = round2([...prior.totals.values()].reduce((s, v) => s + v, 0));
  const endingMrr = round2([...current.totals.values()].reduce((s, v) => s + v, 0));
  const sumCustomers = (cat: BridgeLineCategory) =>
    customers.filter((c) => c.category === cat).reduce((s, c) => s + c.change, 0);

  const newClients = sumCustomers("new_client");
  const priceIncrease = sumCustomers("price_increase");
  const upsell = sumCustomers("upsell");
  const priceDecrease = sumCustomers("price_decrease"); // negative
  const downsell = sumCustomers("downsell"); // negative
  const churn = sumCustomers("churn"); // negative

  // Retention calculations per standard MSP definitions:
  // Net MRR retention includes all existing-customer movements (price Δ + qty Δ + churn)
  // Gross MRR retention excludes upsells/price-increases (only subtractions from base)
  const netRetained = beginningMrr + upsell + priceIncrease + priceDecrease + downsell + churn;
  const netMrrRetentionPct = beginningMrr === 0 ? 0 : round2((netRetained / beginningMrr) * 100);
  const grossRetained = beginningMrr + priceDecrease + downsell + churn;
  const grossMrrRetentionPct = beginningMrr === 0 ? 0 : round2((grossRetained / beginningMrr) * 100);
  const netChange = round2(endingMrr - beginningMrr);
  const mrrGrowthPct = beginningMrr === 0 ? 0 : round2((netChange / beginningMrr) * 100);

  // HubSpot signed-not-onboarded.
  let signedDeals: SignedDeal[] = [];
  let newSigned = 0;
  let hubspotSkipped = skipHubspot;
  if (!skipHubspot) {
    try {
      const deals = await listClosedWonDeals(currentStart, currentEnd);
      const cwLowerNames = new Set<string>();
      for (const key of current.totals.keys()) {
        cwLowerNames.add(key.split("||")[0].toLowerCase().trim());
      }
      for (const deal of deals) {
        const dealName = deal.properties.dealname ?? "";
        const company = dealName.includes("-") ? dealName.split("-")[0].trim() : dealName.trim();
        if (cwLowerNames.has(company.toLowerCase())) continue;
        const mrr = await calculateDealMrr(deal);
        if (mrr > 0) {
          signedDeals.push({ dealName, company, mrr: round2(mrr), closeDate: (deal.properties.closedate ?? "").slice(0, 10) });
        }
      }
      newSigned = signedDeals.reduce((s, d) => s + d.mrr, 0);
    } catch {
      hubspotSkipped = true;
      signedDeals = [];
      newSigned = 0;
    }
  }

  const endingSigned = round2(priorSignedNotOnboarded + newSigned);

  return {
    priorPeriod: monthLabel(priorStart),
    currentPeriod: monthLabel(currentStart),
    priorStart, priorEnd, currentStart, currentEnd,
    beginningMrr,
    endingMrr,
    endingArr: round2(endingMrr * 12),
    newMrrNewClients: round2(newClients),
    newMrrPriceIncrease: round2(priceIncrease),
    newMrrUpsell: round2(upsell),
    lostMrrDownsell: round2(downsell + priceDecrease), // combined for legacy callers
    lostMrrChurn: round2(churn),
    netChange,
    mrrGrowthPct,
    netMrrRetentionPct,
    grossMrrRetentionPct,
    grossMrrChurn: round2(priceDecrease + downsell + churn),
    beginningSignedNotOnboarded: round2(priorSignedNotOnboarded),
    newSignedNotOnboarded: round2(newSigned),
    lessOnboarded: 0,
    endingSignedNotOnboarded: endingSigned,
    hubspotSkipped,
    lines,
    customers,
    signedDeals,
  };
}
