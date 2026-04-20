export type DataSource = {
  kind: "api" | "manual" | "schedule";
  system: string;
  status: "ready" | "planned" | "formula-driven" | "manual";
  note?: string;
};

export type Account = {
  name: string;
  classification: "Assets" | "Liabilities" | "Equity";
  subclassification?: string;
  fsMapping?: string;
};

export type Section = {
  slug: string;
  title: string;
  order: number;
  accounts: string[];
  subtabs: string[];
  dataSources: DataSource[];
  /**
   * When true, the sidebar expands this section to list each mapped BC
   * account as its own sub-tab. Use only where per-account recs exist
   * (Cash, Credit Cards). Other sections use in-page tab strips instead.
   */
  showAccountSubTabs?: boolean;
};

// Generic chart of accounts — no entity-specific balances here.
// Real balances come from Business Central via the API, or a local
// `.data/balances.json` file for demo/offline use. See lib/balances.ts.
export const accounts: Account[] = [
  { name: "Checking Account", classification: "Assets", subclassification: "Current Assets", fsMapping: "Cash" },
  { name: "Clearing Account", classification: "Assets", subclassification: "Current Assets", fsMapping: "Cash" },
  { name: "Accounts Receivable", classification: "Assets", subclassification: "Current Assets", fsMapping: "Accounts Receivable" },
  { name: "Accounts Receivable Adjustment", classification: "Assets", subclassification: "Current Assets", fsMapping: "Accounts Receivable" },
  { name: "Allowance for Doubtful Accounts", classification: "Assets", subclassification: "Current Assets", fsMapping: "Accounts Receivable" },
  { name: "Alternative Payments - Expected Payout", classification: "Assets", subclassification: "Current Assets", fsMapping: "Accounts Receivable" },
  { name: "Inventory", classification: "Assets", subclassification: "Current Assets", fsMapping: "Inventory" },
  { name: "Inventory Interim", classification: "Assets", subclassification: "Current Assets", fsMapping: "Inventory" },
  { name: "Prepaid Other, Current", classification: "Assets", subclassification: "Current Assets", fsMapping: "Prepaids and other current assets" },
  { name: "Unbilled Revenue, Current", classification: "Assets", subclassification: "Current Assets", fsMapping: "Prepaids and other current assets" },
  { name: "Computer Equipment", classification: "Assets", subclassification: "Noncurrent Assets", fsMapping: "Fixed Assets" },
  { name: "Furniture & Fixtures", classification: "Assets", subclassification: "Noncurrent Assets", fsMapping: "Fixed Assets" },
  { name: "Accumulated Depreciation - Furniture", classification: "Assets", subclassification: "Noncurrent Assets", fsMapping: "Fixed Assets" },
  { name: "Accumulated Depreciation - Computer", classification: "Assets", subclassification: "Noncurrent Assets", fsMapping: "Fixed Assets" },
  { name: "Goodwill", classification: "Assets", subclassification: "Noncurrent Assets", fsMapping: "Goodwill" },
  { name: "Accumulated Amortization - Goodwill", classification: "Assets", subclassification: "Noncurrent Assets", fsMapping: "Goodwill" },
  { name: "Right of Use Asset", classification: "Assets", subclassification: "Noncurrent Assets", fsMapping: "Right of use asset" },
  { name: "Due to/from Parent", classification: "Assets", subclassification: "Current Assets", fsMapping: "Intercompany" },
  { name: "Accounts Payable", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Accounts payable" },
  { name: "Accounts Payable Adjustment", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Accounts payable" },
  { name: "Received Not Invoiced", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Accrued expenses" },
  { name: "Due to/from Parent (liability)", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Intercompany" },
  { name: "Accrued Expenses", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Accrued expenses" },
  { name: "Accrued Other Employee Benefits", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Accrued expenses" },
  { name: "Accrued Payroll Tax", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Accrued expenses" },
  { name: "Accrued 401K Match", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Accrued expenses" },
  { name: "Employee FSA Liability", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Accrued expenses" },
  { name: "Accrued PTO", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Accrued expenses" },
  { name: "Accrued Bonus", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Accrued expenses" },
  { name: "Wages Payable", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Accrued expenses" },
  { name: "Corporate Card Payable", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Credit card payables" },
  { name: "Corporate Card Payable - Secondary", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Credit card payables" },
  { name: "Personal Expenses to be Reimbursed", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Other current liabilities" },
  { name: "Customer Deposits, Current", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Other current liabilities" },
  { name: "Sales Tax Payable, Current", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Other current liabilities" },
  { name: "VoIP Taxes Withheld", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Other current liabilities" },
  { name: "Deferred Revenue", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Deferred revenue" },
  { name: "Earnout Liability, Current", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Earnout liabilities" },
  { name: "Earnout Liability, Noncurrent", classification: "Liabilities", subclassification: "Noncurrent Liabilities", fsMapping: "Earnout liabilities" },
  { name: "Deferred Payment Liability", classification: "Liabilities", subclassification: "Noncurrent Liabilities", fsMapping: "Earnout liabilities" },
  { name: "Lease Liability, Current", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Lease liability - ST" },
  { name: "Lease Liability, Noncurrent", classification: "Liabilities", subclassification: "Noncurrent Liabilities", fsMapping: "Lease liability - LT" },
  { name: "Rounding", classification: "Liabilities", subclassification: "Current Liabilities", fsMapping: "Other current liabilities" },
  { name: "Equity Sweep Account", classification: "Equity", subclassification: "Equity", fsMapping: "Equity" },
  { name: "Current Year Earnings", classification: "Equity", subclassification: "Equity", fsMapping: "Equity" },
  { name: "Retained Earnings", classification: "Equity", subclassification: "Equity", fsMapping: "Equity" },
  { name: "Shareholder Contributions", classification: "Equity", subclassification: "Equity", fsMapping: "Equity" },
  { name: "Partner 1 Draws", classification: "Equity", subclassification: "Equity", fsMapping: "Equity" },
  { name: "Partner 1 Equity", classification: "Equity", subclassification: "Equity", fsMapping: "Equity" },
];

export const sections: Section[] = [
  {
    slug: "cash",
    title: "Cash and Cash Equivalents",
    order: 1,
    showAccountSubTabs: true,
    accounts: ["Checking Account", "Clearing Account"],
    subtabs: ["Bank Clearing", "Checking Reconciliation"],
    dataSources: [
      { kind: "api", system: "Business Central", status: "planned", note: "GL balance for cash accounts + posted bank transactions" },
      { kind: "manual", system: "Bank statement", status: "manual", note: "Upload ending balance until a bank feed is wired" },
    ],
  },
  {
    slug: "accounts-receivable",
    title: "AR Rec & Analysis",
    order: 2,
    accounts: ["Accounts Receivable", "Accounts Receivable Adjustment", "Allowance for Doubtful Accounts", "Alternative Payments - Expected Payout"],
    subtabs: ["AR Rec & Analysis", "AR Aging", "Alternative Payments"],
    dataSources: [
      { kind: "api", system: "Business Central", status: "planned", note: "AR subledger + aging report" },
      { kind: "api", system: "ConnectWise", status: "planned", note: "Billed invoices from PSA for dispute/credit reconciliation" },
      { kind: "schedule", system: "Allowance calc", status: "formula-driven", note: "% of aging buckets" },
    ],
  },
  {
    slug: "inventory",
    title: "Inventory",
    order: 3,
    accounts: ["Inventory", "Inventory Interim"],
    subtabs: ["Inventory"],
    dataSources: [
      { kind: "api", system: "Business Central", status: "planned", note: "Inventory valuation report" },
    ],
  },
  {
    slug: "prepaids",
    title: "Prepaids",
    order: 4,
    accounts: ["Prepaid Other, Current"],
    subtabs: ["Prepaids"],
    dataSources: [
      { kind: "api", system: "Business Central", status: "planned", note: "Scans expense postings for one-off items that may belong as prepaid assets" },
      { kind: "api", system: "Ramp", status: "planned", note: "Enrich travel charges with receipt / travel-date info" },
      { kind: "api", system: "Anthropic", status: "planned", note: "Summarize candidates and suggest reclass period" },
    ],
  },
  {
    slug: "accounts-payable",
    title: "Accounts Payable",
    order: 5,
    accounts: ["Accounts Payable", "Accounts Payable Adjustment", "Received Not Invoiced", "Due to/from Parent", "Due to/from Parent (liability)"],
    subtabs: ["AP Rec & Analysis", "AP Aging"],
    dataSources: [
      { kind: "api", system: "Business Central", status: "planned", note: "AP subledger + aging report" },
      { kind: "api", system: "Ramp", status: "planned", note: "Open bills + scheduled payments" },
    ],
  },
  {
    slug: "customer-prepayments",
    title: "Customer Prepayments",
    order: 6,
    accounts: ["Customer Deposits, Current"],
    subtabs: ["Customer Prepayments"],
    dataSources: [
      { kind: "api", system: "Business Central", status: "planned", note: "Customer deposit / unapplied payment balances" },
    ],
  },
  {
    slug: "credit-cards",
    title: "Credit Cards",
    order: 7,
    showAccountSubTabs: true,
    accounts: ["Corporate Card Payable", "Corporate Card Payable - Secondary", "Personal Expenses to be Reimbursed"],
    subtabs: ["Credit Card Reconciliations", "Card Activity", "Due from Employee"],
    dataSources: [
      { kind: "api", system: "Ramp", status: "planned", note: "Statement balance, transaction activity, GL coding" },
      { kind: "api", system: "Business Central", status: "planned", note: "GL tie-out" },
    ],
  },
  {
    slug: "accrued-payroll",
    title: "Accrued Payroll",
    order: 8,
    accounts: ["Wages Payable", "Accrued Wages"],
    subtabs: ["Accrued Payroll"],
    dataSources: [
      { kind: "api", system: "ConnectWise", status: "planned", note: "Per-member allocation percentages from time entries" },
      { kind: "manual", system: "Gusto", status: "manual", note: "Payroll Journal Report CSV upload; drives the JE" },
      { kind: "api", system: "Business Central", status: "planned", note: "TB balance for reconciliation + JE post" },
    ],
  },
  {
    slug: "payroll-liabilities",
    title: "Payroll Liabilities",
    order: 9,
    accounts: ["Accrued Payroll Tax", "Accrued 401K Match", "Employee FSA Liability", "Accrued Other Employee Benefits"],
    subtabs: ["Employee Benefit Liabilities", "HSA Contribution Liability"],
    dataSources: [
      { kind: "api", system: "Gusto", status: "planned", note: "Payroll runs, period-end accrual, ER taxes, 401k match, HSA/FSA" },
      { kind: "api", system: "Business Central", status: "planned", note: "Post accrual JE + reconcile GL" },
    ],
  },
  {
    slug: "accrued-expenses",
    title: "Accrued Expenses",
    order: 10,
    accounts: ["Accrued Expenses", "Accrued Bonus", "Accrued PTO"],
    subtabs: ["Accrued Expenses", "Accrued Bonus", "Accrued PTO"],
    dataSources: [
      { kind: "api", system: "Gusto", status: "planned", note: "PTO balances × wage rates → Accrued PTO" },
      { kind: "api", system: "Business Central", status: "planned", note: "GL tie-out, post adjusting JE" },
    ],
  },
  {
    slug: "tax-liabilities",
    title: "Tax Liabilities",
    order: 11,
    accounts: ["Sales Tax Payable, Current", "VoIP Taxes Withheld"],
    subtabs: ["Sales Tax Payable", "Sales Tax"],
    dataSources: [
      { kind: "api", system: "Business Central", status: "planned", note: "Sales tax liability by jurisdiction from GL" },
      { kind: "manual", system: "Tax engine export", status: "manual", note: "Upload filing report for the period" },
    ],
  },
  {
    slug: "deferred-revenue",
    title: "Deferred Revenue",
    order: 12,
    accounts: ["Deferred Revenue"],
    subtabs: ["Deferred Revenue Reconciliation", "Annual & Block Hours"],
    dataSources: [
      { kind: "api", system: "ConnectWise", status: "planned", note: "Block hour consumption + annual contract status" },
      { kind: "api", system: "Business Central", status: "planned", note: "Remaining performance obligation, recognition JEs" },
    ],
  },
  {
    slug: "unbilled-revenue",
    title: "Unbilled Revenue",
    order: 13,
    accounts: ["Unbilled Revenue, Current"],
    subtabs: ["Unbilled Revenue Rec", "Unbilled Time / Labor", "Unbilled Cloud (Recurring)", "Unbilled Cloud (Non-Recurring)"],
    dataSources: [
      { kind: "api", system: "ConnectWise", status: "planned", note: "Logged time entries not yet invoiced" },
      { kind: "api", system: "Business Central", status: "planned", note: "Unbilled WIP by project, third-party cloud costs not yet re-billed" },
    ],
  },
];

export function findSection(slug: string): Section | undefined {
  return sections.find((s) => s.slug === slug);
}

export function accountsForSection(section: Section): Account[] {
  return accounts.filter((a) => section.accounts.includes(a.name));
}

export function fmt(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n < 0) return `($${s})`;
  if (n === 0) return "–";
  return `$${s}`;
}
