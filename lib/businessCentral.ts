import "server-only";
import { getIntegrationSecrets } from "./settings";

export class BusinessCentralError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "BusinessCentralError";
  }
}

type BcCredentials = {
  tenantId: string;
  environmentName: string;
  companyName: string;
  clientId: string;
  clientSecret: string;
};

async function loadCredentials(): Promise<BcCredentials> {
  const secrets = await getIntegrationSecrets("business-central");
  const required = [
    "tenantId",
    "environmentName",
    "clientId",
    "clientSecret",
  ] as const;
  for (const k of required) {
    if (!secrets[k])
      throw new BusinessCentralError(`Missing Business Central credential: ${k}`, 400);
  }
  return {
    tenantId: secrets.tenantId,
    environmentName: secrets.environmentName,
    companyName: secrets.companyName ?? "",
    clientId: secrets.clientId,
    clientSecret: secrets.clientSecret,
  };
}

type TokenCacheEntry = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenCacheEntry>();

async function getAccessToken(creds: BcCredentials): Promise<string> {
  const cacheKey = `${creds.tenantId}/${creds.clientId}`;
  const cached = tokenCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 30_000) return cached.token;

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
    creds.tenantId
  )}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: "https://api.businesscentral.dynamics.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep as text
    }
    throw new BusinessCentralError(
      `Token request failed: ${res.status} ${res.statusText}`,
      res.status,
      parsed
    );
  }
  const payload = JSON.parse(text) as { access_token: string; expires_in: number };
  const expiresAt = now + payload.expires_in * 1000;
  tokenCache.set(cacheKey, { token: payload.access_token, expiresAt });
  return payload.access_token;
}

export async function bcGet<T>(
  pathAndQuery: string,
  apiVersion: "v1.0" | "v2.0" = "v2.0"
): Promise<T> {
  return bcGetWithRetry<T>(pathAndQuery, apiVersion, false);
}

async function bcGetWithRetry<T>(
  pathAndQuery: string,
  apiVersion: "v1.0" | "v2.0",
  isRetry: boolean
): Promise<T> {
  const creds = await loadCredentials();
  const cacheKey = `${creds.tenantId}/${creds.clientId}`;
  // On a retry after 401, invalidate the cached token first.
  if (isRetry) tokenCache.delete(cacheKey);
  const token = await getAccessToken(creds);
  const url = `https://api.businesscentral.dynamics.com/v2.0/${encodeURIComponent(
    creds.tenantId
  )}/${encodeURIComponent(creds.environmentName)}/api/${apiVersion}${pathAndQuery}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    // A 401 almost always means our cached access token got revoked or the
    // client secret rotated. Invalidate the cache and retry once with a fresh
    // token before surfacing the error.
    if (res.status === 401 && !isRetry) {
      return bcGetWithRetry<T>(pathAndQuery, apiVersion, true);
    }
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep as text
    }
    throw new BusinessCentralError(
      `BC ${res.status} ${res.statusText}`,
      res.status,
      parsed
    );
  }
  return JSON.parse(text) as T;
}

export type BcCompany = {
  id: string;
  systemVersion: string;
  name: string;
  displayName: string;
  businessProfileId?: string;
};

export async function listCompanies(): Promise<BcCompany[]> {
  const res = await bcGet<{ value: BcCompany[] }>("/companies");
  return res.value;
}

export type BcCategory =
  | "Assets"
  | "Liabilities"
  | "Equity"
  | "Income"
  | "CostOfGoodsSold"
  | "Expense"
  | "_x0020_";

export type BcAccount = {
  id: string;
  number: string;
  displayName: string;
  category: BcCategory | string;
  subCategory: string;
  accountType: string;
  directPosting: boolean;
  blocked: boolean;
};

async function getSelectedCompanyId(): Promise<string> {
  const creds = await loadCredentials();
  if (!creds.companyName) {
    throw new BusinessCentralError("No Business Central company selected", 400);
  }
  const companies = await listCompanies();
  const match = companies.find(
    (c) => c.name === creds.companyName || c.displayName === creds.companyName || c.id === creds.companyName
  );
  if (!match) {
    throw new BusinessCentralError(
      `Business Central company '${creds.companyName}' not found in tenant`,
      404
    );
  }
  return match.id;
}

/**
 * Lists posting-enabled, non-blocked GL accounts for the selected company.
 */
export async function listAccounts(): Promise<BcAccount[]> {
  const companyId = await getSelectedCompanyId();
  const path =
    `/companies(${companyId})/accounts?` +
    `$filter=accountType eq 'Posting' and blocked eq false&` +
    `$select=id,number,displayName,category,subCategory,accountType,directPosting,blocked&` +
    `$orderby=number`;
  const res = await bcGet<{ value: BcAccount[] }>(
    path.replace(/ /g, "%20").replace(/'/g, "%27")
  );
  return res.value;
}

export type BcInventoryItem = {
  id: string;
  number: string;
  displayName: string;
  type: string;
  inventory: number;
  unitCost: number;
  baseUnitOfMeasureCode: string;
  itemCategoryCode?: string;
  blocked: boolean;
};

/**
 * Lists inventory-type items that have a non-zero quantity on hand.
 * BC's v2.0 items endpoint doesn't support filtering on `inventory`, so we
 * paginate server-side on type='Inventory' and filter in-process.
 */
export async function listInventoryOnHand(): Promise<BcInventoryItem[]> {
  const companyId = await getSelectedCompanyId();
  const path =
    `/companies(${companyId})/items?` +
    `$filter=type eq 'Inventory' and blocked eq false&` +
    `$select=id,number,displayName,type,inventory,unitCost,baseUnitOfMeasureCode,itemCategoryCode,blocked&` +
    `$orderby=number`;
  const out: BcInventoryItem[] = [];
  let next: string | null = path.replace(/ /g, "%20").replace(/'/g, "%27");
  while (next) {
    const page: BcPage<BcInventoryItem> = next.startsWith("http")
      ? await bcGetAbsolute<BcPage<BcInventoryItem>>(next)
      : await bcGet<BcPage<BcInventoryItem>>(next);
    for (const it of page.value) {
      if (it.inventory && it.inventory !== 0) out.push(it);
    }
    next = page["@odata.nextLink"] ?? null;
  }
  return out;
}

export type BcAgedReceivableRow = {
  customerId: string;
  customerNumber: string;
  name: string;
  currencyCode: string;
  balanceDue: number;
  currentAmount: number;
  period1Amount: number; // 31-60 (for 30D period)
  period2Amount: number; // 61-90
  period3Amount: number; // 91+
  agedAsOfDate: string;
  periodLengthFilter: string;
};

export type AgedReceivables = {
  asOfDate: string;
  periodLengthFilter: string;
  total: {
    balanceDue: number;
    current: number;
    period1: number;
    period2: number;
    period3: number;
  };
  customers: BcAgedReceivableRow[]; // excludes the synthetic "Total" row
};

export async function getAgedReceivables(): Promise<AgedReceivables> {
  const companyId = await getSelectedCompanyId();
  const res = await bcGet<{ value: BcAgedReceivableRow[] }>(
    `/companies(${companyId})/agedAccountsReceivable`,
    "v1.0"
  );
  const rows = res.value;
  const totalRow = rows.find(
    (r) => r.customerId === "00000000-0000-0000-0000-000000000000" || r.name === "Total"
  );
  const customers = rows
    .filter((r) => r !== totalRow && r.balanceDue !== 0)
    .sort((a, b) => b.balanceDue - a.balanceDue);
  const asOfDate = totalRow?.agedAsOfDate ?? rows[0]?.agedAsOfDate ?? "";
  const periodLengthFilter = totalRow?.periodLengthFilter ?? "30D";
  return {
    asOfDate,
    periodLengthFilter,
    total: {
      balanceDue: totalRow?.balanceDue ?? 0,
      current: totalRow?.currentAmount ?? 0,
      period1: totalRow?.period1Amount ?? 0,
      period2: totalRow?.period2Amount ?? 0,
      period3: totalRow?.period3Amount ?? 0,
    },
    customers,
  };
}

export type BcAgedPayableRow = {
  vendorId: string;
  vendorNumber: string;
  name: string;
  currencyCode: string;
  balanceDue: number;
  currentAmount: number;
  period1Amount: number;
  period2Amount: number;
  period3Amount: number;
  agedAsOfDate: string;
  periodLengthFilter: string;
};

export type AgedPayables = {
  asOfDate: string;
  periodLengthFilter: string;
  total: {
    balanceDue: number;
    current: number;
    period1: number;
    period2: number;
    period3: number;
  };
  vendors: BcAgedPayableRow[];
};

export type BcPurchaseInvoice = {
  id: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  vendorId: string;
  vendorNumber: string;
  vendorName: string;
  status: string;
  totalAmountIncludingTax: number;
  remainingAmount?: number;
  dimensionSetLines?: {
    code: string;
    valueCode: string;
    valueDisplayName: string;
  }[];
};

/**
 * Posted purchase invoices with invoice date in [startDate, endDate] (inclusive).
 * Used to cross-reference GL entry documentNumbers back to vendor names.
 */
export async function listPurchaseInvoicesRange(
  startDate: string,
  endDate: string
): Promise<BcPurchaseInvoice[]> {
  const companyId = await getSelectedCompanyId();
  const filter = `invoiceDate ge ${startDate} and invoiceDate le ${endDate}`;
  const path =
    `/companies(${companyId})/purchaseInvoices?` +
    `$filter=${encodeURIComponent(filter)}&` +
    `$select=id,number,invoiceDate,vendorId,vendorNumber,vendorName,status,totalAmountIncludingTax`;
  const out: BcPurchaseInvoice[] = [];
  let next: string | null = path;
  while (next) {
    const page: BcPage<BcPurchaseInvoice> = next.startsWith("http")
      ? await bcGetAbsolute<BcPage<BcPurchaseInvoice>>(next)
      : await bcGet<BcPage<BcPurchaseInvoice>>(next);
    out.push(...page.value);
    next = page["@odata.nextLink"] ?? null;
  }
  return out;
}

/**
 * Returns open purchase invoices whose dimensionSetLines include an
 * INTERCOMPANY dimension value — i.e. AP bills that should be reclassed from
 * regular AP (e.g. 200010) to the intercompany payable account (117950).
 */
export async function listOpenIntercompanyApInvoices(): Promise<BcPurchaseInvoice[]> {
  const companyId = await getSelectedCompanyId();
  const path =
    `/companies(${companyId})/purchaseInvoices?` +
    `$filter=status eq 'Open'&` +
    `$expand=dimensionSetLines&` +
    `$top=500`;
  const res = await bcGet<{ value: BcPurchaseInvoice[] }>(
    path.replace(/'/g, "%27").replace(/ /g, "%20")
  );
  return (res.value || []).filter((inv) =>
    (inv.dimensionSetLines || []).some(
      (d) => d.code === "INTERCOMPANY" && /^IC-/i.test(d.valueCode)
    )
  );
}

export type BcSalesCreditMemo = {
  id: string;
  number: string;
  invoiceDate?: string;
  postingDate?: string;
  customerId?: string;
  customerNumber?: string;
  customerName?: string;
  totalAmountIncludingTax?: number;
  // When the AP user posted the credit against a specific invoice, BC populates
  // these. Empty invoiceNumber + zero-GUID invoiceId → standalone credit with
  // no target invoice (roughly 65% of credit memos in this tenant).
  invoiceId?: string;
  invoiceNumber?: string;
};

/**
 * Posted sales credit memos with posting date in [startDate, endDate].
 * SCM-* document numbers in GL entries resolve back to a customer via this.
 */
export async function listSalesCreditMemos(
  startDate: string,
  endDate: string
): Promise<BcSalesCreditMemo[]> {
  const companyId = await getSelectedCompanyId();
  const filter = `postingDate ge ${startDate} and postingDate le ${endDate}`;
  const path =
    `/companies(${companyId})/salesCreditMemos?` +
    `$filter=${encodeURIComponent(filter)}&` +
    `$select=id,number,postingDate,customerId,customerNumber,customerName,totalAmountIncludingTax,invoiceId,invoiceNumber`;
  const out: BcSalesCreditMemo[] = [];
  let next: string | null = path;
  while (next) {
    const page: BcPage<BcSalesCreditMemo> = next.startsWith("http")
      ? await bcGetAbsolute<BcPage<BcSalesCreditMemo>>(next)
      : await bcGet<BcPage<BcSalesCreditMemo>>(next);
    out.push(...page.value);
    next = page["@odata.nextLink"] ?? null;
  }
  return out;
}

export async function getAgedPayables(): Promise<AgedPayables> {
  const companyId = await getSelectedCompanyId();
  const res = await bcGet<{ value: BcAgedPayableRow[] }>(
    `/companies(${companyId})/agedAccountsPayable`,
    "v1.0"
  );
  const rows = res.value;
  const totalRow = rows.find(
    (r) => r.vendorId === "00000000-0000-0000-0000-000000000000" || r.name === "Total"
  );
  const vendors = rows
    .filter((r) => r !== totalRow && r.balanceDue !== 0)
    .sort((a, b) => b.balanceDue - a.balanceDue);
  const asOfDate = totalRow?.agedAsOfDate ?? rows[0]?.agedAsOfDate ?? "";
  const periodLengthFilter = totalRow?.periodLengthFilter ?? "30D";
  return {
    asOfDate,
    periodLengthFilter,
    total: {
      balanceDue: totalRow?.balanceDue ?? 0,
      current: totalRow?.currentAmount ?? 0,
      period1: totalRow?.period1Amount ?? 0,
      period2: totalRow?.period2Amount ?? 0,
      period3: totalRow?.period3Amount ?? 0,
    },
    vendors,
  };
}

type BcGlEntry = {
  accountNumber: string;
  debitAmount: number;
  creditAmount: number;
};

type BcPage<T> = { value: T[]; "@odata.nextLink"?: string };

/**
 * Returns per-account balance (sum of debit - credit on all posted GL entries
 * with postingDate <= `asOf`). BC v2.0 does not support server-side $apply
 * aggregation on generalLedgerEntries, so we page through and sum in-process.
 * Safe for typical small-business chart sizes (<100k entries per period).
 */
export async function getAccountBalances(
  asOf: string
): Promise<Map<string, number>> {
  const companyId = await getSelectedCompanyId();
  const filter = `postingDate le ${asOf}`;
  const path =
    `/companies(${companyId})/generalLedgerEntries?` +
    `$filter=${encodeURIComponent(filter)}&` +
    `$select=accountNumber,debitAmount,creditAmount`;

  const balances = new Map<string, number>();
  let next: string | null = path;
  while (next) {
    const page: BcPage<BcGlEntry> = next.startsWith("http")
      ? await bcGetAbsolute<BcPage<BcGlEntry>>(next)
      : await bcGet<BcPage<BcGlEntry>>(next);
    for (const e of page.value) {
      const current = balances.get(e.accountNumber) ?? 0;
      balances.set(e.accountNumber, current + (e.debitAmount ?? 0) - (e.creditAmount ?? 0));
    }
    next = page["@odata.nextLink"] ?? null;
  }
  return balances;
}

export type BcGlMonthlyActivity = {
  month: string; // yyyy-mm
  debit: number;
  credit: number;
  net: number; // debit - credit (asset perspective)
};

/**
 * Returns per-month debit/credit totals for a single GL account across a
 * date range. Used for deferred-revenue rollforward and revenue-recognition
 * visibility.
 */
export async function getAccountMonthlyActivity(
  accountNumber: string,
  startDate: string,
  endDate: string
): Promise<BcGlMonthlyActivity[]> {
  const companyId = await getSelectedCompanyId();
  const filter =
    `accountNumber eq '${accountNumber}' and ` +
    `postingDate ge ${startDate} and postingDate le ${endDate}`;
  const path =
    `/companies(${companyId})/generalLedgerEntries?` +
    `$filter=${encodeURIComponent(filter)}&` +
    `$select=postingDate,debitAmount,creditAmount&` +
    `$orderby=postingDate`;
  const byMonth = new Map<string, { d: number; c: number }>();
  let next: string | null = path;
  while (next) {
    const page: BcPage<{ postingDate: string; debitAmount: number; creditAmount: number }> =
      next.startsWith("http")
        ? await bcGetAbsolute<BcPage<{ postingDate: string; debitAmount: number; creditAmount: number }>>(next)
        : await bcGet<BcPage<{ postingDate: string; debitAmount: number; creditAmount: number }>>(next);
    for (const e of page.value) {
      const ym = (e.postingDate ?? "").slice(0, 7);
      if (!ym) continue;
      const prev = byMonth.get(ym) ?? { d: 0, c: 0 };
      byMonth.set(ym, {
        d: prev.d + (e.debitAmount ?? 0),
        c: prev.c + (e.creditAmount ?? 0),
      });
    }
    next = page["@odata.nextLink"] ?? null;
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, debit: v.d, credit: v.c, net: v.d - v.c }));
}

export type BcGlLedgerEntry = {
  entryNumber: number;
  postingDate: string;
  documentNumber: string;
  documentType: string;
  accountNumber: string;
  description: string;
  debitAmount: number;
  creditAmount: number;
};

/**
 * Returns the GL entries posted to `accountNumber` between
 * `startDate` and `endDate` (inclusive), ordered by posting date.
 * Handles pagination.
 */
export async function listGlEntries(
  accountNumber: string,
  startDate: string,
  endDate: string
): Promise<BcGlLedgerEntry[]> {
  const companyId = await getSelectedCompanyId();
  const filter =
    `accountNumber eq '${accountNumber}' and ` +
    `postingDate ge ${startDate} and postingDate le ${endDate}`;
  const path =
    `/companies(${companyId})/generalLedgerEntries?` +
    `$filter=${encodeURIComponent(filter)}&` +
    `$select=entryNumber,postingDate,documentNumber,documentType,accountNumber,description,debitAmount,creditAmount&` +
    `$orderby=postingDate,entryNumber`;

  const out: BcGlLedgerEntry[] = [];
  let next: string | null = path;
  while (next) {
    const page: BcPage<BcGlLedgerEntry> = next.startsWith("http")
      ? await bcGetAbsolute<BcPage<BcGlLedgerEntry>>(next)
      : await bcGet<BcPage<BcGlLedgerEntry>>(next);
    out.push(...page.value);
    next = page["@odata.nextLink"] ?? null;
  }
  return out;
}

export type BcDimensionLine = {
  code: string;
  valueCode: string;
  valueDisplayName: string;
};

export type BcGlLedgerEntryWithDims = BcGlLedgerEntry & {
  dimensionSetLines?: BcDimensionLine[];
};

/**
 * GL entries posted in [startDate, endDate] across ALL accounts (or filtered
 * by a set of account numbers), with dimensionSetLines expanded when BC
 * supports it on this endpoint. Falls back silently to no-dimensions if BC
 * rejects the $expand — `dimensionSetLines` will be undefined on each row.
 */
export async function listGlEntriesRange(
  startDate: string,
  endDate: string,
  accountNumbers?: string[]
): Promise<BcGlLedgerEntryWithDims[]> {
  const companyId = await getSelectedCompanyId();
  const parts: string[] = [`postingDate ge ${startDate}`, `postingDate le ${endDate}`];
  if (accountNumbers && accountNumbers.length > 0) {
    const acctClause = accountNumbers
      .map((n) => `accountNumber eq '${n}'`)
      .join(" or ");
    parts.push(`(${acctClause})`);
  }
  const filter = parts.join(" and ");
  const baseSelect = `entryNumber,postingDate,documentNumber,documentType,accountNumber,description,debitAmount,creditAmount`;

  const withExpand =
    `/companies(${companyId})/generalLedgerEntries?` +
    `$filter=${encodeURIComponent(filter)}&` +
    `$select=${baseSelect}&` +
    `$expand=dimensionSetLines&` +
    `$orderby=postingDate,entryNumber`;
  const withoutExpand =
    `/companies(${companyId})/generalLedgerEntries?` +
    `$filter=${encodeURIComponent(filter)}&` +
    `$select=${baseSelect}&` +
    `$orderby=postingDate,entryNumber`;

  async function pageThrough(startPath: string): Promise<BcGlLedgerEntryWithDims[]> {
    const out: BcGlLedgerEntryWithDims[] = [];
    let next: string | null = startPath;
    while (next) {
      const page: BcPage<BcGlLedgerEntryWithDims> = next.startsWith("http")
        ? await bcGetAbsolute<BcPage<BcGlLedgerEntryWithDims>>(next)
        : await bcGet<BcPage<BcGlLedgerEntryWithDims>>(next);
      out.push(...page.value);
      next = page["@odata.nextLink"] ?? null;
    }
    return out;
  }

  try {
    return await pageThrough(withExpand);
  } catch (err) {
    // If BC doesn't support $expand on generalLedgerEntries (some tenants
    // return 400/501), fall back to the un-expanded query so the P&L still
    // renders — just without dimension breakouts.
    if (err instanceof BusinessCentralError && (err.status === 400 || err.status === 501)) {
      return pageThrough(withoutExpand);
    }
    throw err;
  }
}

async function bcGetAbsolute<T>(absoluteUrl: string): Promise<T> {
  const creds = await loadCredentials();
  const token = await getAccessToken(creds);
  const res = await fetch(absoluteUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep as text
    }
    throw new BusinessCentralError(
      `BC ${res.status} ${res.statusText}`,
      res.status,
      parsed
    );
  }
  return JSON.parse(text) as T;
}

export type BcSalesInvoice = {
  id: string;
  number: string;
  externalDocumentNumber?: string;
  invoiceDate: string;
  dueDate: string;
  customerId: string;
  customerNumber: string;
  customerName: string;
  status: string;
  totalAmountIncludingTax: number;
  remainingAmount?: number;
};

/**
 * Posted sales invoices with invoice date in [startDate, endDate] (inclusive).
 * BC returns posted invoices via `/salesInvoices` — drafts/quotes live on other
 * endpoints and aren't useful for a GL-level reconciliation.
 */
export async function listSalesInvoices(
  startDate: string,
  endDate: string
): Promise<BcSalesInvoice[]> {
  const companyId = await getSelectedCompanyId();
  const filter = `invoiceDate ge ${startDate} and invoiceDate le ${endDate}`;
  const path =
    `/companies(${companyId})/salesInvoices?` +
    `$filter=${encodeURIComponent(filter)}&` +
    `$select=id,number,externalDocumentNumber,invoiceDate,dueDate,customerId,customerNumber,customerName,status,totalAmountIncludingTax,remainingAmount&` +
    `$orderby=invoiceDate`;
  const out: BcSalesInvoice[] = [];
  let next: string | null = path;
  while (next) {
    const page: BcPage<BcSalesInvoice> = next.startsWith("http")
      ? await bcGetAbsolute<BcPage<BcSalesInvoice>>(next)
      : await bcGet<BcPage<BcSalesInvoice>>(next);
    out.push(...page.value);
    next = page["@odata.nextLink"] ?? null;
  }
  return out;
}

export type BcCustomerLedgerEntry = {
  id: string;
  entryNumber: number;
  postingDate: string;
  documentType: string; // "Invoice" | "Credit Memo" | "Payment" | "Refund" | etc.
  documentNumber: string;
  externalDocumentNumber?: string;
  customerNumber: string;
  customerName: string;
  description?: string;
  amount: number;
  remainingAmount: number;
  open: boolean;
  dueDate?: string;
};

/**
 * Returns all OPEN customer ledger entries (invoices, credit memos, etc.)
 * as of the given date. Filters server-side to open=true so we only get
 * entries with a remaining balance — includes credit memos and all AR types.
 */
export async function listOpenCustomerLedgerEntries(): Promise<BcCustomerLedgerEntry[]> {
  const companyId = await getSelectedCompanyId();
  // customerLedgerEntries is a v1.0 entity — not available in the v2.0 API surface.
  const path =
    `/companies(${companyId})/customerLedgerEntries?` +
    `$filter=open eq true&` +
    `$orderby=postingDate`;
  const out: BcCustomerLedgerEntry[] = [];
  let next: string | null = path;
  while (next) {
    const page: BcPage<BcCustomerLedgerEntry> = next.startsWith("http")
      ? await bcGetAbsolute<BcPage<BcCustomerLedgerEntry>>(next)
      : await bcGet<BcPage<BcCustomerLedgerEntry>>(next, "v1.0");
    out.push(...page.value);
    next = page["@odata.nextLink"] ?? null;
  }
  return out;
}

export async function getSelectedCompany(): Promise<BcCompany | null> {
  const creds = await loadCredentials();
  if (!creds.companyName) return null;
  const companies = await listCompanies();
  return (
    companies.find(
      (c) =>
        c.name === creds.companyName ||
        c.displayName === creds.companyName ||
        c.id === creds.companyName
    ) ?? null
  );
}
