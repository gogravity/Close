import { readFile } from "node:fs/promises";
import path from "node:path";
import "server-only";

const CATALOG_FILE = path.join(process.cwd(), ".data", "bs-row-catalog.json");

export type CatalogRow = {
  row: number;
  flag: string | null;
  bcAccount: string | null;
  account: string | null;
  unadjusted: number | null;
  adjustment: number | null;
  adjusted: number | null;
  reconciled: number | null;
  variance: number | null;
  sourceTab: string | null;
  comment: string | null;
};

export type Catalog = {
  source: string;
  asOf: string;
  rows: CatalogRow[];
};

export async function loadCatalog(): Promise<Catalog | null> {
  try {
    const raw = await readFile(CATALOG_FILE, "utf8");
    return JSON.parse(raw) as Catalog;
  } catch {
    return null;
  }
}

export type AutomationStrategy =
  | "bc-live"
  | "bc-schedule"
  | "cw-api"
  | "ramp-api"
  | "gusto-api"
  | "plaid-bank"
  | "alt-payments-api"
  | "roll-forward"
  | "manual"
  | "closed"
  | "none";

export type SourceTabPlan = {
  tab: string;
  strategy: AutomationStrategy;
  sourceSystem: string;
  status: "automatable" | "partial" | "manual-only" | "dormant";
  rationale: string;
};

/**
 * Per–source-tab automation plan. The strategy reflects how we intend to
 * calculate the adjustment for accounts whose reconciliation lives on this tab.
 */
export const SOURCE_TAB_PLANS: Record<string, SourceTabPlan> = {
  "Gravity US Bank": {
    tab: "Gravity US Bank",
    strategy: "plaid-bank",
    sourceSystem: "US Bank (Plaid) + BC",
    status: "partial",
    rationale:
      "Bank feed statement ending balance vs BC GL. Plaid not wired; interim: upload bank statement CSV.",
  },
  "AR Rec & Analysis": {
    tab: "AR Rec & Analysis",
    strategy: "bc-live",
    sourceSystem: "BC AR Aging + ConnectWise",
    status: "automatable",
    rationale:
      "BC AR subledger gives aging buckets. CW invoices cross-check. Allowance is a formula on aging.",
  },
  "AR Aging": {
    tab: "AR Aging",
    strategy: "bc-live",
    sourceSystem: "BC AR Aging",
    status: "automatable",
    rationale: "Same source as AR Rec & Analysis — aging buckets from BC subledger.",
  },
  "Alternative Payments": {
    tab: "Alternative Payments",
    strategy: "alt-payments-api",
    sourceSystem: "Alternative Payments",
    status: "partial",
    rationale:
      "Expected payout balance from Alt Payments API. If no public API, treat as manual upload.",
  },
  "FlexPoint Holdings": {
    tab: "FlexPoint Holdings",
    strategy: "closed",
    sourceSystem: "FlexPoint",
    status: "dormant",
    rationale: "Account closed per comment. Should be zero; flag if non-zero in BC.",
  },
  "Prepaid Expenses": {
    tab: "Prepaid Expenses",
    strategy: "bc-schedule",
    sourceSystem: "Amortization schedule (BC)",
    status: "automatable",
    rationale:
      "Straight-line amortization per prepaid contract. Schedule rolls forward; monthly entry is deterministic.",
  },
  "Prepaid COGS": {
    tab: "Prepaid COGS",
    strategy: "bc-schedule",
    sourceSystem: "COGS amortization schedule",
    status: "automatable",
    rationale: "Same as Prepaid Expenses — schedule-driven.",
  },
  "Prepaid Rent": {
    tab: "Prepaid Rent",
    strategy: "bc-schedule",
    sourceSystem: "Rent schedule",
    status: "automatable",
    rationale: "Straight-line rent amortization.",
  },
  "Building Deposits": {
    tab: "Building Deposits",
    strategy: "manual",
    sourceSystem: "Lease agreement",
    status: "manual-only",
    rationale: "Static refundable deposit. No recurring adjustment.",
  },
  "Unbilled Revenue Rec": {
    tab: "Unbilled Revenue Rec",
    strategy: "cw-api",
    sourceSystem: "ConnectWise time + agreements",
    status: "automatable",
    rationale:
      "Logged-not-invoiced time entries × billing rate; plus recurring cloud activity not yet re-billed.",
  },
  "Cloud Third Party - Monthly": {
    tab: "Cloud Third Party - Monthly",
    strategy: "cw-api",
    sourceSystem: "ConnectWise + Pax8 (future)",
    status: "partial",
    rationale: "Monthly cloud subscription activity; Pax8 not wired yet.",
  },
  "Cloud Third Party - Annual": {
    tab: "Cloud Third Party - Annual",
    strategy: "cw-api",
    sourceSystem: "ConnectWise + Pax8 (future)",
    status: "partial",
    rationale: "Annual cloud subscription activity.",
  },
  "Cloud Computing": {
    tab: "Cloud Computing",
    strategy: "cw-api",
    sourceSystem: "ConnectWise",
    status: "automatable",
    rationale: "Cloud computing time entries from CW.",
  },
  "Credit Card Reconciliations": {
    tab: "Credit Card Reconciliations",
    strategy: "ramp-api",
    sourceSystem: "Ramp (active) + closed cards",
    status: "automatable",
    rationale:
      "Ramp statement balance compared to BC GL. Closed cards (Amex Gold/Platinum, Capital One) should be zero.",
  },
  Ramp: {
    tab: "Ramp",
    strategy: "ramp-api",
    sourceSystem: "Ramp",
    status: "automatable",
    rationale: "Statement balance + activity from Ramp API.",
  },
  "Amex Platinum": {
    tab: "Amex Platinum",
    strategy: "closed",
    sourceSystem: "Amex",
    status: "dormant",
    rationale: "Account closed.",
  },
  "Due from Employee": {
    tab: "Due from Employee",
    strategy: "manual",
    sourceSystem: "Expense reports",
    status: "manual-only",
    rationale: "Individual reimbursements. Low volume, manual review.",
  },
  "GOODWILL- REVISED": {
    tab: "GOODWILL- REVISED",
    strategy: "bc-schedule",
    sourceSystem: "Goodwill amortization schedule",
    status: "automatable",
    rationale: "Monthly amortization per acquisition agreement. Fully deterministic.",
  },
  "GOODWILL-Revision3": {
    tab: "GOODWILL-Revision3",
    strategy: "bc-schedule",
    sourceSystem: "Goodwill amortization schedule",
    status: "automatable",
    rationale: "Same — schedule-driven amortization.",
  },
  "Goodwill Amortization": {
    tab: "Goodwill Amortization",
    strategy: "bc-schedule",
    sourceSystem: "Goodwill amortization schedule",
    status: "automatable",
    rationale: "Monthly amortization.",
  },
  "FA Depreciation Schedule": {
    tab: "FA Depreciation Schedule",
    strategy: "bc-schedule",
    sourceSystem: "Fixed-asset schedule",
    status: "automatable",
    rationale: "Straight-line depreciation per asset class. Deterministic roll-forward.",
  },
  "1a. Lease T&C - Onyx Pointe": {
    tab: "Lease ASC 842 schedule",
    strategy: "bc-schedule",
    sourceSystem: "ASC 842 lease schedule",
    status: "automatable",
    rationale: "ROU asset amortization + interest on lease liability. Schedule-driven.",
  },
  "1c. ASC 842 - Onyx Pointe": {
    tab: "Lease ASC 842 schedule",
    strategy: "bc-schedule",
    sourceSystem: "ASC 842 lease schedule",
    status: "automatable",
    rationale: "Same — monthly ASC 842 JE is deterministic.",
  },
  "AP Rec & Analysis": {
    tab: "AP Rec & Analysis",
    strategy: "bc-live",
    sourceSystem: "BC AP subledger + Ramp bill pay",
    status: "automatable",
    rationale: "Open bills + vendor credits from BC. Reclass vendor prepayments to prepaid assets.",
  },
  "AP Aging": {
    tab: "AP Aging",
    strategy: "bc-live",
    sourceSystem: "BC AP subledger",
    status: "automatable",
    rationale: "Aging buckets from BC.",
  },
  "Accrued Expenses": {
    tab: "Accrued Expenses",
    strategy: "bc-live",
    sourceSystem: "BC open POs + manual",
    status: "partial",
    rationale: "Open POs with no vendor invoice received. BC can surface these.",
  },
  "Accrued Bonus": {
    tab: "Accrued Bonus",
    strategy: "manual",
    sourceSystem: "Comp plan vs YTD performance",
    status: "manual-only",
    rationale:
      "Bonus accrual is a management estimate based on performance to date. Requires human judgment.",
  },
  "Accrued Bonus - Employees": {
    tab: "Accrued Bonus",
    strategy: "manual",
    sourceSystem: "Comp plan vs YTD performance",
    status: "manual-only",
    rationale: "Same — management estimate.",
  },
  "Accrued PTO": {
    tab: "Accrued PTO",
    strategy: "gusto-api",
    sourceSystem: "Gusto PTO balances",
    status: "automatable",
    rationale: "Hours outstanding × hourly rate. Gusto exposes both.",
  },
  "Accrued Payroll": {
    tab: "Accrued Payroll",
    strategy: "gusto-api",
    sourceSystem: "Gusto payroll runs",
    status: "automatable",
    rationale: "Wages earned but not yet paid at period-end. Gusto has run dates and gross wages.",
  },
  "Employee Benefit Liabilities": {
    tab: "Employee Benefit Liabilities",
    strategy: "gusto-api",
    sourceSystem: "Gusto benefits",
    status: "automatable",
    rationale: "Employer portion of benefits accrued but not yet remitted.",
  },
  "HSA Contribution Liability": {
    tab: "HSA Contribution Liability",
    strategy: "gusto-api",
    sourceSystem: "Gusto HSA",
    status: "automatable",
    rationale: "HSA employer contributions accrued but not yet deposited.",
  },
  "Sales Tax Payable": {
    tab: "Sales Tax Payable",
    strategy: "bc-live",
    sourceSystem: "BC sales tax report",
    status: "automatable",
    rationale: "Sales tax collected - remitted by jurisdiction.",
  },
  "Sales Tax": {
    tab: "Sales Tax",
    strategy: "bc-live",
    sourceSystem: "BC sales tax report",
    status: "automatable",
    rationale: "Same as Sales Tax Payable.",
  },
  "Customer Prepayments": {
    tab: "Customer Prepayments",
    strategy: "bc-live",
    sourceSystem: "BC unapplied customer payments",
    status: "automatable",
    rationale: "Reclass customer prepayments from AR credits to customer deposit liability.",
  },
  "Deferred Payment": {
    tab: "Deferred Payment",
    strategy: "roll-forward",
    sourceSystem: "Acquisition agreement",
    status: "manual-only",
    rationale: "Scheduled payment per acquisition agreement. Static balance until paid.",
  },
  "Deferred Revenue Reconciliation": {
    tab: "Deferred Revenue Reconciliation",
    strategy: "cw-api",
    sourceSystem: "ConnectWise agreements (block hours + annual)",
    status: "automatable",
    rationale: "Unearned portion of annual and block-hour contracts from CW.",
  },
  "Annual & Block Hours": {
    tab: "Annual & Block Hours",
    strategy: "cw-api",
    sourceSystem: "ConnectWise agreements",
    status: "automatable",
    rationale: "Block hour consumption feeds revenue recognition.",
  },
  "Earnout Liability": {
    tab: "Earnout Liability",
    strategy: "roll-forward",
    sourceSystem: "Acquisition agreement",
    status: "manual-only",
    rationale: "Per acquisition agreement. Static until paid.",
  },
  Inventory: {
    tab: "Inventory",
    strategy: "bc-live",
    sourceSystem: "BC Inventory valuation",
    status: "automatable",
    rationale: "BC Inventory valuation report; write-downs are ad-hoc.",
  },
};

export function planFor(tab: string | null): SourceTabPlan | null {
  if (!tab) return null;
  return SOURCE_TAB_PLANS[tab] ?? null;
}
