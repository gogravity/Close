import "server-only";
import { getIntegrationSecrets } from "./settings";

export class ConnectWiseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "ConnectWiseError";
  }
}

type CwCredentials = {
  siteUrl: string;
  companyId: string;
  publicKey: string;
  privateKey: string;
  clientId: string;
};

async function loadCredentials(): Promise<CwCredentials> {
  const secrets = await getIntegrationSecrets("connectwise");
  const required = ["siteUrl", "companyId", "publicKey", "privateKey", "clientId"] as const;
  for (const k of required) {
    if (!secrets[k]) throw new ConnectWiseError(`Missing ConnectWise credential: ${k}`, 400);
  }
  return secrets as CwCredentials;
}

function buildAuthHeader(creds: CwCredentials): string {
  const userPart = `${creds.companyId}+${creds.publicKey}`;
  const token = Buffer.from(`${userPart}:${creds.privateKey}`).toString("base64");
  return `Basic ${token}`;
}

function normalizeHost(siteUrl: string): string {
  // Accept any of: "na.myconnectwise.net", "https://na.myconnectwise.net",
  // or a full API URL like "https://na.myconnectwise.net/v4_6_release/apis/3.0".
  // We always want just the host.
  const trimmed = siteUrl.trim().replace(/^https?:\/\//i, "");
  const slashIdx = trimmed.indexOf("/");
  return slashIdx === -1 ? trimmed : trimmed.slice(0, slashIdx);
}

export async function cwGet<T = unknown>(pathAndQuery: string): Promise<T> {
  const creds = await loadCredentials();
  const host = normalizeHost(creds.siteUrl);
  const url = `https://${host}/v4_6_release/apis/3.0${pathAndQuery}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: buildAuthHeader(creds),
      clientId: creds.clientId,
      Accept: "application/vnd.connectwise.com+json; version=2020.1",
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep as text
    }
    throw new ConnectWiseError(`CW ${res.status} ${res.statusText}`, res.status, body);
  }
  return JSON.parse(text) as T;
}

export async function cwPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  const creds = await loadCredentials();
  const host = normalizeHost(creds.siteUrl);
  const url = `https://${host}/v4_6_release/apis/3.0${path}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: buildAuthHeader(creds),
      clientId: creds.clientId,
      "Content-Type": "application/json",
      Accept: "application/vnd.connectwise.com+json; version=2020.1",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let errBody: unknown = text;
    try {
      errBody = JSON.parse(text);
    } catch {
      // keep as text
    }
    throw new ConnectWiseError(`CW PATCH ${res.status} ${res.statusText}`, res.status, errBody);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function cwPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const creds = await loadCredentials();
  const host = normalizeHost(creds.siteUrl);
  const url = `https://${host}/v4_6_release/apis/3.0${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: buildAuthHeader(creds),
      clientId: creds.clientId,
      "Content-Type": "application/json",
      Accept: "application/vnd.connectwise.com+json; version=2020.1",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let errBody: unknown = text;
    try { errBody = JSON.parse(text); } catch { /* keep as text */ }
    throw new ConnectWiseError(`CW POST ${res.status} ${res.statusText}`, res.status, errBody);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export type CwSystemInfo = {
  version: string;
  isCloud: boolean;
  serverTimeZone: string;
  cloudRegion?: string;
  licenseBits: { name: string; activeFlag: boolean }[];
};

export async function getSystemInfo(): Promise<CwSystemInfo> {
  return cwGet<CwSystemInfo>("/system/info");
}

export type CwCompanyRow = {
  id: number;
  identifier: string;
  name: string;
};

/**
 * Lightweight reachability check used by the settings "Test" button.
 * Confirms the key pair can authenticate and list at least one company.
 */
export async function pingCompanies(): Promise<number> {
  const rows = await cwGet<CwCompanyRow[]>(
    "/company/companies?pageSize=1&fields=id"
  );
  return rows.length;
}

export type CwInvoice = {
  id: number;
  invoiceNumber: string;
  date: string; // ISO, may include time
  dueDate?: string;
  status?: { id: number; name: string };
  type?: string;
  // CW's `total` field is the pre-tax invoice total in this tenant; `salesTax`
  // is the tax component. The recon sums them to match BC's totalAmountIncludingTax.
  subtotal?: number;
  total: number;
  salesTax?: number;
  balance?: number;
  company?: { id: number; identifier: string; name: string };
  agreement?: { id: number; name: string };
};

/**
 * Finance invoices with invoice date in [startDate, endDate] (inclusive).
 * CW's /finance/invoices conditions use square-bracketed date literals and
 * ISO datetimes on the `date` field. Paginates via ?page/?pageSize (max 1000).
 */
export async function listInvoices(
  startDate: string,
  endDate: string
): Promise<CwInvoice[]> {
  const cond = `date >= [${startDate}T00:00:00Z] and date <= [${endDate}T23:59:59Z]`;
  const pageSize = 1000;
  const fields =
    "id,invoiceNumber,date,dueDate,status,type,subtotal,total,salesTax,balance,company,agreement";
  const out: CwInvoice[] = [];
  let page = 1;
  while (true) {
    const rows = await cwGet<CwInvoice[]>(
      `/finance/invoices?conditions=${encodeURIComponent(
        cond
      )}&orderBy=date&fields=${fields}&page=${page}&pageSize=${pageSize}`
    );
    out.push(...rows);
    if (rows.length < pageSize) break;
    page += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Unbilled Revenue (WIP) support
//
// Rules of the road for CW's `/time/entries` and `/project/*` endpoints — the
// hard way, from prior investigation:
//   - `invoice = null` in a condition → 400 "Enum value supplied was invalid".
//     Filter uninvoiced entries CLIENT-SIDE after fetching.
//   - `billableOption != 'DoNotBill'` in a condition → sometimes 400. Filter
//     client-side too.
//   - `chargeToType = 'Project'` returns nothing; the real enum value is
//     'ProjectTicket' (and 'ServiceTicket' for service time).
//   - Field lists containing non-existent fields return 400 — keep the list
//     minimal and match what's documented on the entity.
//   - `chargeToId` on a time entry is the **ticket** id, not the project id.
//     Resolve project via /project/tickets in chunks of ~150 IDs.
// ---------------------------------------------------------------------------

export type CwTicketTimeEntry = {
  id: number;
  chargeToId?: number;
  actualHours?: number;
  hourlyRate?: number;
  hourlyCost?: number;
  dateEntered?: string;
  billableOption?: string; // "Billable" | "DoNotBill" | "NoCharge" | "NoDefault"
  invoice?: { id?: number; name?: string } | null;
  invoiceReady?: boolean;
};

/**
 * Project-ticket time entries with dateEntered in the given window. The
 * sinceDate floor is REQUIRED — unbounded fetches pull every entry in tenant
 * history and can take minutes on busy CW instances. For unbilled revenue,
 * 6–12 months back is usually plenty (anything older that's still unbilled
 * is a data-hygiene issue, not in-flight work).
 */
export async function listProjectTicketTimeEntries(
  sinceDate: string,
  asOfDate: string
): Promise<CwTicketTimeEntry[]> {
  return listTimeEntriesByChargeType("ProjectTicket", sinceDate, asOfDate);
}

export async function listServiceTicketTimeEntries(
  sinceDate: string,
  asOfDate: string
): Promise<CwTicketTimeEntry[]> {
  return listTimeEntriesByChargeType("ServiceTicket", sinceDate, asOfDate);
}

async function listTimeEntriesByChargeType(
  chargeToType: "ProjectTicket" | "ServiceTicket",
  sinceDate: string,
  asOfDate: string
): Promise<CwTicketTimeEntry[]> {
  const cond =
    `chargeToType = '${chargeToType}' ` +
    `and dateEntered >= [${sinceDate}T00:00:00Z] ` +
    `and dateEntered <= [${asOfDate}T23:59:59Z]`;
  const fields =
    "id,chargeToId,actualHours,hourlyRate,hourlyCost,dateEntered,billableOption,invoice,invoiceReady";
  const pageSize = 1000;
  const out: CwTicketTimeEntry[] = [];
  let page = 1;
  while (true) {
    const rows = await cwGet<CwTicketTimeEntry[]>(
      `/time/entries?conditions=${encodeURIComponent(
        cond
      )}&fields=${fields}&page=${page}&pageSize=${pageSize}`
    );
    out.push(...rows);
    if (rows.length < pageSize) break;
    page += 1;
  }
  return out;
}

export type CwOpenProject = {
  id: number;
  name?: string;
  status?: { id: number; name?: string };
  company?: { id: number; name?: string };
  manager?: { id: number; name?: string };
  billingMethod?: string; // "FixedFee" | "ActualRates" | "NotToExceed" | "OverrideRate"
  billingAmount?: number;
  budgetHours?: number;
  estimatedHours?: number;
  scheduledHours?: number;
  actualHours?: number;
  percentComplete?: number;
  estimatedTimeCost?: number;
  estimatedTimeRevenue?: number;
  estimatedExpenseCost?: number;
  estimatedExpenseRevenue?: number;
  estimatedProductCost?: number;
  estimatedProductRevenue?: number;
};

/**
 * Open (non-closed) projects with the fields needed to classify billing
 * method + show cost/revenue context next to each unbilled-revenue decision.
 */
export async function listOpenProjects(): Promise<CwOpenProject[]> {
  const cond = `closedFlag = false`;
  const fields = [
    "id",
    "name",
    "status",
    "company",
    "manager",
    "billingMethod",
    "billingAmount",
    "budgetHours",
    "estimatedHours",
    "scheduledHours",
    "actualHours",
    "percentComplete",
    "estimatedTimeCost",
    "estimatedTimeRevenue",
    "estimatedExpenseCost",
    "estimatedExpenseRevenue",
    "estimatedProductCost",
    "estimatedProductRevenue",
  ].join(",");
  const pageSize = 1000;
  const out: CwOpenProject[] = [];
  let page = 1;
  while (true) {
    const rows = await cwGet<CwOpenProject[]>(
      `/project/projects?conditions=${encodeURIComponent(
        cond
      )}&fields=${fields}&page=${page}&pageSize=${pageSize}`
    );
    out.push(...rows);
    if (rows.length < pageSize) break;
    page += 1;
  }
  return out;
}

/**
 * Resolve ticket IDs to their parent project IDs. CW `id in (…)` conditions
 * cap around 500 values per request; doc recommends ~150.
 */
export async function getTicketProjectMap(
  ticketIds: number[]
): Promise<Map<number, number>> {
  const unique = [...new Set(ticketIds)];
  const out = new Map<number, number>();
  const chunk = 150;
  for (let i = 0; i < unique.length; i += chunk) {
    const ids = unique.slice(i, i + chunk);
    const cond = `id in (${ids.join(",")})`;
    const rows = await cwGet<Array<{ id: number; project?: { id?: number } }>>(
      `/project/tickets?conditions=${encodeURIComponent(
        cond
      )}&fields=id,project&pageSize=1000`
    );
    for (const r of rows) {
      if (typeof r.id === "number" && r.project?.id != null) {
        out.set(r.id, r.project.id);
      }
    }
  }
  return out;
}

/**
 * Resolve service-ticket IDs to their company names for display.
 */
export async function getServiceTicketCompanyMap(
  ticketIds: number[]
): Promise<Map<number, { ticketSummary: string; companyName: string }>> {
  const unique = [...new Set(ticketIds)];
  const out = new Map<number, { ticketSummary: string; companyName: string }>();
  const chunk = 150;
  for (let i = 0; i < unique.length; i += chunk) {
    const ids = unique.slice(i, i + chunk);
    const cond = `id in (${ids.join(",")})`;
    const rows = await cwGet<
      Array<{
        id: number;
        summary?: string;
        company?: { id?: number; name?: string };
      }>
    >(
      `/service/tickets?conditions=${encodeURIComponent(
        cond
      )}&fields=id,summary,company&pageSize=1000`
    );
    for (const r of rows) {
      if (typeof r.id === "number") {
        out.set(r.id, {
          ticketSummary: r.summary ?? "",
          companyName: r.company?.name ?? "",
        });
      }
    }
  }
  return out;
}

/**
 * OPEN service tickets only (closedFlag = false). Used to filter unbilled
 * time to in-flight work — closed tickets are either invoiced or won't be,
 * and they don't belong on the WIP report.
 */
export async function listOpenServiceTickets(): Promise<
  Array<{ id: number; summary: string; companyName: string }>
> {
  const cond = `closedFlag = false`;
  const pageSize = 1000;
  const out: Array<{ id: number; summary: string; companyName: string }> = [];
  let page = 1;
  while (true) {
    const rows = await cwGet<
      Array<{
        id: number;
        summary?: string;
        company?: { id?: number; name?: string };
      }>
    >(
      `/service/tickets?conditions=${encodeURIComponent(
        cond
      )}&fields=id,summary,company&page=${page}&pageSize=${pageSize}`
    );
    for (const r of rows) {
      if (typeof r.id === "number") {
        out.push({
          id: r.id,
          summary: r.summary ?? "",
          companyName: r.company?.name ?? "",
        });
      }
    }
    if (rows.length < pageSize) break;
    page += 1;
  }
  return out;
}

/**
 * OPEN project tickets only. Returns id + parent project id so callers can
 * both filter by open status AND resolve project association in one go.
 */
export async function listOpenProjectTickets(): Promise<
  Array<{ id: number; projectId: number | null }>
> {
  const cond = `closedFlag = false`;
  const pageSize = 1000;
  const out: Array<{ id: number; projectId: number | null }> = [];
  let page = 1;
  while (true) {
    const rows = await cwGet<
      Array<{ id: number; project?: { id?: number } }>
    >(
      `/project/tickets?conditions=${encodeURIComponent(
        cond
      )}&fields=id,project&page=${page}&pageSize=${pageSize}`
    );
    for (const r of rows) {
      if (typeof r.id === "number") {
        out.push({ id: r.id, projectId: r.project?.id ?? null });
      }
    }
    if (rows.length < pageSize) break;
    page += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// MRR Bridge support — agreement additions, procurement catalog, companies
// ---------------------------------------------------------------------------

export type CwAgreementAddition = {
  id: number;
  quantity: number;
  unitPrice: number;
  billCustomer?: string; // "Billable" | "DoNotBill" | etc.
  effectiveDate?: string;
  cancelledDate?: string | null;
  product?: { identifier?: string; name?: string };
};

/**
 * All billable additions on an agreement. Filter active ones by date window
 * in the caller — CW returns every addition regardless of status, so we
 * slice them to a snapshot on a given date in the bridge code.
 */
export async function listAgreementAdditions(
  agreementId: number
): Promise<CwAgreementAddition[]> {
  const pageSize = 250;
  const out: CwAgreementAddition[] = [];
  let page = 1;
  while (true) {
    const rows = await cwGet<CwAgreementAddition[]>(
      `/finance/agreements/${agreementId}/additions?pageSize=${pageSize}&page=${page}`
    );
    out.push(...rows);
    if (rows.length < pageSize) break;
    page += 1;
  }
  return out;
}

export type CwCatalogItem = {
  identifier: string;
  subcategory?: { id?: number; name?: string };
};

/**
 * Product catalog with subcategory info for classifying line-item changes.
 * Cloud subcategories ("365 Monthly", "Azure", etc.) are treated as usage /
 * upsell rather than price increases in the MRR bridge logic.
 */
export async function listProcurementCatalog(): Promise<CwCatalogItem[]> {
  const pageSize = 1000;
  const out: CwCatalogItem[] = [];
  let page = 1;
  while (true) {
    const rows = await cwGet<CwCatalogItem[]>(
      `/procurement/catalog?pageSize=${pageSize}&page=${page}&fields=identifier,subcategory`
    );
    out.push(...rows);
    if (rows.length < pageSize) break;
    page += 1;
  }
  return out;
}

/**
 * All CW company names. Used as a historical-customer source so a newly
 * billing customer who already exists in CW doesn't get miscategorized as
 * net-new revenue in the MRR bridge.
 */
export async function listAllCompanyNames(): Promise<string[]> {
  const pageSize = 1000;
  const out: string[] = [];
  let page = 1;
  while (true) {
    const rows = await cwGet<Array<{ name?: string }>>(
      `/company/companies?pageSize=${pageSize}&page=${page}&fields=name`
    );
    for (const r of rows) {
      const name = (r.name ?? "").trim();
      if (name) out.push(name);
    }
    if (rows.length < pageSize) break;
    page += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Payroll section — full time-entry fetch with member / agreement / dept context
// ---------------------------------------------------------------------------

export type CwPayrollTimeEntry = {
  id: number;
  timeStart?: string;
  dateEntered?: string;
  actualHours?: number;
  hoursBilled?: number;
  hourlyCost?: number;
  hourlyRate?: number;
  billableOption?: string; // Billable | DoNotBill | NoCharge | NoDefault
  member?: { id?: number; identifier?: string; name?: string };
  department?: { id?: number; name?: string };
  agreement?: { id?: number; name?: string; type?: string };
  /** CW duplicates the agreement type onto the entry itself — useful when the
   *  agreement object isn't populated but the type label still is. */
  agreementType?: string;
  ticket?: { id?: number; name?: string; summary?: string };
  ticketBoard?: string;
  ticketType?: string;
  chargeToType?: string;
  chargeToId?: number;
  company?: { id?: number; name?: string };
  workType?: { id?: number; name?: string };
  notes?: string;
};

/**
 * All time entries with timeStart in [startDate, endDate]. Used by the payroll
 * allocation page — we need full context (agreement, department, ticket board,
 * etc.) to bucket each entry, which is why we don't narrow $select here.
 */
export async function listTimeEntriesForRange(
  startDate: string,
  endDate: string
): Promise<CwPayrollTimeEntry[]> {
  const cond =
    `timeStart >= [${startDate}T00:00:00Z] and timeStart <= [${endDate}T23:59:59Z]`;
  const pageSize = 1000;
  const out: CwPayrollTimeEntry[] = [];
  let page = 1;
  while (true) {
    const rows = await cwGet<CwPayrollTimeEntry[]>(
      `/time/entries?conditions=${encodeURIComponent(
        cond
      )}&orderBy=timeStart&page=${page}&pageSize=${pageSize}`
    );
    out.push(...rows);
    if (rows.length < pageSize) break;
    page += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// AR Cleanup helpers
// ---------------------------------------------------------------------------

/**
 * All CW invoices with balance > 0 — no date restriction. Used for the AR
 * cleanup tool to find invoices that are still open in CW but closed in BC.
 */
export async function listAllOpenCwInvoices(): Promise<CwInvoice[]> {
  const cond = `balance > 0`;
  const pageSize = 1000;
  const fields =
    "id,invoiceNumber,date,dueDate,status,type,subtotal,total,salesTax,balance,company,agreement";
  const out: CwInvoice[] = [];
  let page = 1;
  while (true) {
    const rows = await cwGet<CwInvoice[]>(
      `/finance/invoices?conditions=${encodeURIComponent(
        cond
      )}&orderBy=date&fields=${fields}&page=${page}&pageSize=${pageSize}`
    );
    out.push(...rows);
    if (rows.length < pageSize) break;
    page += 1;
  }
  return out;
}

/**
 * Zero out a CW invoice balance by posting a payment for the full balance.
 * If the invoice already has a payment record, patches it instead.
 * paymentDate should be an ISO datetime string (e.g. "2024-03-31T00:00:00Z").
 */
export async function applyPaymentToCwInvoice(
  invoiceId: number,
  balance: number,
  paymentDate: string
): Promise<void> {
  // Check for existing payment records
  const existing = await getCwInvoicePayments(invoiceId);
  if (existing.length === 0) {
    // POST a new payment
    await cwPost(`/finance/invoices/${invoiceId}/payments`, {
      type: "P",
      amount: balance,
      paymentDate,
    });
  } else {
    // PATCH the existing payment to cover the full remaining balance
    const p = existing[0];
    const newAmount = p.amount + balance;
    await cwPatch(`/finance/invoices/${invoiceId}/payments/${p.id}`, [
      { op: "replace", path: "amount", value: newAmount },
      { op: "replace", path: "paymentDate", value: paymentDate },
    ]);
  }
}

export type CwInvoicePayment = {
  id: number;
  type: string;         // "P" = payment, "C" = credit, etc.
  amount: number;
  balance: number;
  paymentDate: string;  // ISO datetime
  appliedBy?: string;
  paymentSyncStatus?: string;
};

/**
 * Returns the payment line items applied to a specific CW invoice.
 * Used for lazy-loading payment details in the AR reconciliation UI.
 */
export async function getCwInvoicePayments(invoiceId: number): Promise<CwInvoicePayment[]> {
  const rows = await cwGet<CwInvoicePayment[]>(
    `/finance/invoices/${invoiceId}/payments?pageSize=100`
  );
  return Array.isArray(rows) ? rows : [];
}
