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
// ---------------------------------------------------------------------------

const MRR_ACCOUNTS = [
  "400010", // Managed IT Services
  "402010", // Recurring Cloud Resale
  "402030", // Recurring Cybersecurity Resale
  "402040", // Recurring VOIP & Connectivity Resale
  "402050", // Recurring HaaS / Private Hosting
];

const CLOUD_SUBCATEGORIES = new Set(["365 Monthly", "365 Annual", "Azure"]);

// Known customer-name aliases → canonical display name.
const CUSTOMER_ALIASES: Record<string, string> = {
  "lyra communications": "Telco Experts",
  "telco experts": "Telco Experts",
  "telarus": "Telarus",
};

export type MrrBridgeInput = {
  priorStart: string; // YYYY-MM-DD
  priorEnd: string;
  currentStart: string;
  currentEnd: string;
  priorSignedNotOnboarded?: number;
  /** When HubSpot isn't configured, set to true to skip the pipeline fetch. */
  skipHubspot?: boolean;
};

export type BridgeLineCategory =
  | "new_client"
  | "price_increase"
  | "upsell"
  | "downsell"
  | "churn"
  | "flat";

export type BridgeLine = {
  rowId: string; // stable id for client-side state keyed to this line
  company: string;
  agreement: string;
  agreementId: number | null; // null when the line isn't mapped to a CW agreement
  priorMrr: number;
  currentMrr: number;
  change: number;
  category: BridgeLineCategory;
  // Populated for lines backed by a CW agreement — lets the UI drill into
  // per-product detail on expand.
  products?: ProductChange[];
  // Sum of per-product price-increase sub-amounts (positive = price up).
  priceIncreaseAmount?: number;
};

/**
 * Customer-level roll-up. Movement detail + summary totals flow through
 * customers so credit-memo / offsetting agreement lines net out for the
 * same customer (e.g. KDC's credit memo no longer inflates both upsell
 * and downsell columns).
 */
export type BridgeCustomer = {
  customerId: string; // normalized company name
  customerName: string; // display name
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
  priorPeriod: string; // "Feb 2026"
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

  lines: BridgeLine[]; // flat per-agreement lines (legacy consumers)
  customers: BridgeCustomer[]; // customer-grouped view used by the UI
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

/** Normalize a CW/BC company name for cross-month matching. Strips parenthetical
 *  suffixes so "Preferred Rate (American Pacific)" and "Preferred Rate (Margo)"
 *  consolidate to "Preferred Rate". */
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
  // ACH style: "COMPANY NAME: X   SEC CODE: Y"
  const achMatch = /COMPANY NAME:\s*([^\s]+(?:\s+[^\s]+)*?)\s{2,}/.exec(desc);
  if (achMatch) {
    return canonicalizeCustomer(achMatch[1].trim().replace(/,$/, "").trim());
  }
  // Comma-separated with no "Invoice" → first segment
  if (desc.includes(",") && !desc.includes("Invoice")) {
    return canonicalizeCustomer(desc.split(",")[0].trim());
  }
  // "Customer - Invoice XXX"
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
  net: number; // credit - debit
};

async function fetchGlEntries(start: string, end: string): Promise<GlRow[]> {
  // One query for all MRR accounts at once (server-side filtered).
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

async function fetchCwInvoiceMap(
  start: string,
  end: string
): Promise<Map<string, CwInvoiceInfo>> {
  // 7-day buffer on each side catches invoices dated near the period boundary
  // but posted to GL inside the period.
  const invoices = await listInvoices(shiftDate(start, -7), shiftDate(end, 7));
  return buildCwInvoiceMap(invoices);
}

async function fetchDgCustomerMap(
  start: string,
  end: string
): Promise<Map<string, string>> {
  // DG-* document numbers on GL rows map to BC sales invoices with the same
  // number. Only DG-* prefixed ones are Datagate-billed VoIP customers.
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
  /** When the credit memo was applied to a specific invoice in BC, this is
   *  that invoice's number. Empty string if standalone. */
  appliedToInvoice: string;
};

async function fetchScmCustomerMap(
  start: string,
  end: string
): Promise<Map<string, ScmInfo>> {
  // Credit memos (SCM-*) — capture both the customer name and, when present,
  // the specific invoice the credit was applied against. Linked credits fold
  // into the original invoice's agreement key during `buildAgreementTotals`.
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
    out.set(m.number, {
      customerName: m.customerName ?? "",
      appliedToInvoice: linkedInvoice,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Agreement addition snapshots (for price-increase vs upsell classification)
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
  // The category this individual product-level delta falls into under the
  // standard rules (pre-override). The line-level category the user sees may
  // be an aggregated/overridden version of this.
  category: "new_product" | "removed_product" | "price_increase" | "upsell" | "downsell" | "flat";
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
    const bd: LineItemBreakdown = {
      priceIncrease: 0,
      upsell: 0,
      downsell: 0,
      products: [],
    };
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
        bd.upsell += cur.total;
        pc = { ...pc, category: "new_product" };
      } else if (pri && !cur) {
        bd.downsell -= pri.total;
        pc = { ...pc, category: "removed_product" };
      } else if (cur && pri) {
        const delta = cur.total - pri.total;
        if (Math.abs(delta) < 0.005) {
          // Flat — no movement; don't emit a product row.
          continue;
        }
        const isCloud = CLOUD_SUBCATEGORIES.has(subcat);
        const sameQty = cur.quantity === pri.quantity;
        const priceUp = cur.unitPrice > pri.unitPrice;
        const priceDown = cur.unitPrice < pri.unitPrice;
        if (isCloud) {
          if (delta > 0) {
            bd.upsell += delta;
            pc = { ...pc, category: "upsell" };
          } else {
            bd.downsell += delta;
            pc = { ...pc, category: "downsell" };
          }
        } else if (sameQty && priceUp) {
          bd.priceIncrease += delta;
          pc = { ...pc, category: "price_increase" };
        } else if (sameQty && priceDown) {
          bd.downsell += delta;
          pc = { ...pc, category: "downsell" };
        } else if (delta > 0) {
          bd.upsell += delta;
          pc = { ...pc, category: "upsell" };
        } else {
          bd.downsell += delta;
          pc = { ...pc, category: "downsell" };
        }
      }
      bd.products.push(pc);
    }
    // Largest absolute change first so the expanded view reads top-to-bottom.
    bd.products.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    out.set(agrId, bd);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

type TotalsResult = {
  totals: Map<string, number>; // key = "company||agreement"
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

  // For deferred revenue journal entries (GJ-*) skip the offsetting invoice
  // rows and only count the "Adjusting Deferred Charge" rows — prototype rule.
  const rowsByDoc = new Map<string, GlRow[]>();
  for (const r of glRows) {
    const arr = rowsByDoc.get(r.documentNumber);
    if (arr) arr.push(r);
    else rowsByDoc.set(r.documentNumber, [r]);
  }

  const filtered: GlRow[] = [];
  for (const [doc, rows] of rowsByDoc.entries()) {
    if (doc.startsWith("GJ-")) {
      const hasDeferred = rows.some((r) =>
        /Adjusting Deferred/i.test(r.description)
      );
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

  // Canonical description per document:
  //   - If any row has "Adjusting Deferred Charge", use that.
  //   - Otherwise pick the row with the largest absolute net.
  const docDescriptions = new Map<string, string>();
  for (const [doc, rows] of rowsByDoc.entries()) {
    const deferred = rows.find((r) => /Adjusting Deferred/i.test(r.description));
    if (deferred) {
      docDescriptions.set(doc, deferred.description);
    } else {
      const best = [...rows].sort(
        (a, b) => Math.abs(b.net) - Math.abs(a.net)
      )[0];
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
        // Credit memo was applied to a specific CW invoice — fold the credit
        // into that invoice's agreement key so it appears as a reduction in
        // the customer's regular agreement line instead of a standalone
        // "Credit Memo Adjustment" line.
        company = linkedInvoiceInfo.company;
        agreement = linkedInvoiceInfo.agreement;
        agrId = linkedInvoiceInfo.agreementId;
      } else if (scm?.customerName) {
        // Standalone credit memo — keep as customer-level adjustment so the
        // customer rollup still captures it, but flag the agreement row.
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

/** Consolidate keys whose company name normalizes to the same base. */
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
 * Roll up per-agreement bridge lines into per-customer rows. Uses the FULL
 * prior/current customer totals (including flat agreements not represented
 * as a BridgeLine) so the customer-level category reflects the customer's
 * true MRR state, not just the changed slice.
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
    // Derive customer category from the net position:
    //  - if every underlying agreement is flagged new_client (by the line
    //    classifier with 12mo lookback), inherit new_client
    //  - all-churn agreements → churn
    //  - all-price_increase → price_increase
    //  - otherwise fall back to sign of net change
    let category: BridgeLineCategory = "flat";
    const cats = new Set(agreements.map((a) => a.category));
    if (priorMrr <= 0.005 && currentMrr > 0 && cats.has("new_client")) {
      category = "new_client";
    } else if (currentMrr <= 0.005 && priorMrr > 0 && cats.has("churn")) {
      category = "churn";
    } else if (cats.size === 1 && cats.has("price_increase")) {
      category = "price_increase";
    } else {
      // Price-increase net check: if the customer's net change is essentially
      // all price-increase movement summed across their agreements, classify
      // the customer as price_increase.
      const totalPriceIncrease = agreements.reduce(
        (s, a) => s + (a.priceIncreaseAmount ?? 0),
        0
      );
      if (change > 0 && Math.abs(change - totalPriceIncrease) < 1 && totalPriceIncrease > 0) {
        category = "price_increase";
      } else if (Math.abs(change) <= 0.005) {
        category = "flat";
      } else if (change > 0) {
        category = "upsell";
      } else {
        category = "downsell";
      }
    }
    // Sort agreements within a customer by magnitude (largest absolute first).
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
  // Largest swing first across customers.
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

  // 1. BC sales invoices in the lookback window.
  const invoices = await listSalesInvoices(lookbackStart, lookbackEnd);
  for (const inv of invoices) {
    const n = (inv.customerName ?? "").trim();
    if (n) out.add(normalizeCompany(n));
  }

  // 2. BC GL journal entries on MRR accounts — parse customer from description.
  const gl = await listGlEntriesRange(lookbackStart, lookbackEnd, MRR_ACCOUNTS);
  for (const e of gl) {
    if (!e.documentNumber?.startsWith("GJ-")) continue;
    const customer = extractJeCustomer(e.description ?? "");
    if (customer) out.add(normalizeCompany(customer));
  }

  // 3. Any CW company counts as known.
  const cwNames = await listAllCompanyNames();
  for (const n of cwNames) {
    out.add(normalizeCompany(canonicalizeCustomer(n)));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Bridge computation
// ---------------------------------------------------------------------------

export async function computeMrrBridge(
  input: MrrBridgeInput
): Promise<MrrBridgeResult> {
  const {
    priorStart,
    priorEnd,
    currentStart,
    currentEnd,
    priorSignedNotOnboarded = 0,
    skipHubspot = false,
  } = input;

  // Pull everything in parallel where independent.
  const [
    priorGl,
    currentGl,
    priorCwMap,
    currentCwMap,
    priorDgMap,
    currentDgMap,
    priorScmMap,
    currentScmMap,
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

  const priorRaw = buildAgreementTotals(priorGl, priorCwMap, priorDgMap, priorScmMap);
  const currentRaw = buildAgreementTotals(
    currentGl,
    currentCwMap,
    currentDgMap,
    currentScmMap
  );
  const prior = consolidateTotals(priorRaw);
  const current = consolidateTotals(currentRaw);

  // Build bridge lines for keys where the amount changed.
  const allKeys = new Set<string>([...prior.totals.keys(), ...current.totals.keys()]);
  const lines: BridgeLine[] = [];
  for (const key of allKeys) {
    const priorVal = round2(prior.totals.get(key) ?? 0);
    const currentVal = round2(current.totals.get(key) ?? 0);
    if (Math.abs(currentVal - priorVal) <= 0.005) continue;
    const [company, agreement] = key.split("||");
    const change = round2(currentVal - priorVal);
    let category: BridgeLineCategory = "flat";
    if (priorVal === 0 && currentVal > 0) category = "new_client";
    else if (change > 0) category = "upsell";
    else if (change < 0) category = "downsell";
    const agreementId =
      current.agreementIds.get(key) ?? prior.agreementIds.get(key) ?? null;
    lines.push({
      rowId: `${company}||${agreement}`,
      company,
      agreement,
      agreementId,
      priorMrr: priorVal,
      currentMrr: currentVal,
      change,
      category,
    });
  }

  // Customer-level classification overrides — churn only when total customer MRR
  // drops to 0; new_client only when total was 0 before.
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
    const priorCust = priorByCompany.get(line.company) ?? 0;
    const currentCust = currentByCompany.get(line.company) ?? 0;
    if (line.priorMrr > 0 && line.currentMrr === 0) {
      line.category = currentCust > 0 ? "downsell" : "churn";
    } else if (line.priorMrr === 0 && line.currentMrr > 0) {
      line.category = priorCust > 0 ? "upsell" : "new_client";
    }
  }

  // 12-month lookback: flip provisional new_client to upsell if the customer
  // existed historically (BC sales invoice, JE description, or CW company).
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

  // Line-item analysis on every agreement-backed line (new_client / churn /
  // upsell / downsell) — we need the per-product detail for the expand view
  // on all of them, and the price_increase preset is only meaningful for
  // upsell candidates but is cheap to evaluate for every line.
  const agrIdsToCheck = new Set<number>();
  for (const l of lines) {
    if (l.agreementId != null) agrIdsToCheck.add(l.agreementId);
  }
  if (agrIdsToCheck.size > 0) {
    const breakdowns = await classifyAgreementLineItems(
      agrIdsToCheck,
      priorEnd,
      currentEnd
    );
    for (const l of lines) {
      if (l.agreementId == null) continue;
      const bd = breakdowns.get(l.agreementId);
      if (!bd) continue;
      l.products = bd.products;
      l.priceIncreaseAmount = round2(bd.priceIncrease);
      // Preset to price_increase if the agreement's net change is essentially
      // all price-increase movement (within $1 of total).
      const totalAbs =
        Math.abs(bd.priceIncrease) + Math.abs(bd.upsell) + Math.abs(bd.downsell);
      if (
        l.category === "upsell" &&
        bd.priceIncrease > 0 &&
        Math.abs(totalAbs - bd.priceIncrease) < 1
      ) {
        l.category = "price_increase";
      }
    }
  }

  lines.sort((a, b) => a.change - b.change);

  // Group agreement lines by customer so offsetting agreements (e.g. a credit
  // memo on one "agreement key" + normal billing on another) net at the
  // customer level instead of appearing as separate upsell + downsell swings.
  const customers = groupByCustomer(lines, priorByCompany, currentByCompany);

  // Summary totals: straight sum over CUSTOMER-level categories. User edits
  // on the client flow through this same sum-by-category.
  const beginningMrr = round2([...prior.totals.values()].reduce((s, v) => s + v, 0));
  const endingMrr = round2([...current.totals.values()].reduce((s, v) => s + v, 0));
  const sumCustomers = (cat: BridgeLineCategory) =>
    customers.filter((c) => c.category === cat).reduce((s, c) => s + c.change, 0);
  const newClients = sumCustomers("new_client");
  const priceIncrease = sumCustomers("price_increase");
  const upsell = sumCustomers("upsell");
  const downsell = sumCustomers("downsell");
  const churn = sumCustomers("churn");

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
        const company = dealName.includes("-")
          ? dealName.split("-")[0].trim()
          : dealName.trim();
        if (cwLowerNames.has(company.toLowerCase())) continue;
        const mrr = await calculateDealMrr(deal);
        if (mrr > 0) {
          signedDeals.push({
            dealName,
            company,
            mrr: round2(mrr),
            closeDate: (deal.properties.closedate ?? "").slice(0, 10),
          });
        }
      }
      newSigned = signedDeals.reduce((s, d) => s + d.mrr, 0);
    } catch {
      hubspotSkipped = true;
      signedDeals = [];
      newSigned = 0;
    }
  }

  const netChange = round2(endingMrr - beginningMrr);
  const mrrGrowthPct = beginningMrr === 0 ? 0 : round2((netChange / beginningMrr) * 100);
  // Net retention: (Beginning + upsell + priceIncrease + downsell + churn) / Beginning.
  // Downsell + churn are already negative sums, so we add (not subtract).
  const netRetained = beginningMrr + upsell + priceIncrease + downsell + churn;
  const netMrrRetentionPct =
    beginningMrr === 0 ? 0 : round2((netRetained / beginningMrr) * 100);
  const grossRetained = beginningMrr + downsell + churn;
  const grossMrrRetentionPct =
    beginningMrr === 0 ? 0 : round2((grossRetained / beginningMrr) * 100);
  const endingSigned = round2(priorSignedNotOnboarded + newSigned);

  return {
    priorPeriod: monthLabel(priorStart),
    currentPeriod: monthLabel(currentStart),
    priorStart,
    priorEnd,
    currentStart,
    currentEnd,
    beginningMrr,
    endingMrr,
    endingArr: round2(endingMrr * 12),
    newMrrNewClients: round2(newClients),
    newMrrPriceIncrease: priceIncrease,
    newMrrUpsell: upsell,
    lostMrrDownsell: round2(downsell),
    lostMrrChurn: round2(churn),
    netChange,
    mrrGrowthPct,
    netMrrRetentionPct,
    grossMrrRetentionPct,
    grossMrrChurn: round2(downsell + churn),
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
