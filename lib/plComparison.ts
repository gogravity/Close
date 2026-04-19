import "server-only";
import {
  listAccounts,
  listGlEntriesRange,
  listSalesInvoices,
  listPurchaseInvoicesRange,
  type BcAccount,
  type BcDimensionLine,
} from "./businessCentral";

export type PlCategory = "Income" | "CostOfGoodsSold" | "Expense";

export type MonthKey = string; // "YYYY-MM"

export type SubaccountKey = {
  code: string;
  label: string;
};

export type PlCustomerRow = {
  counterparty: string;
  monthly: Record<MonthKey, number>;
  avgPrior: number;
  current: number;
  variance: number;
  variancePct: number;
  flagged: boolean;
};

export type PlSubaccountRow = {
  subaccount: SubaccountKey; // "(no subaccount)" used when entries are missing it on a mixed account
  monthly: Record<MonthKey, number>;
  avgPrior: number;
  current: number;
  variance: number;
  variancePct: number;
  flagged: boolean;
  customers: PlCustomerRow[];
};

export type PlAccountGroup = {
  accountNumber: string;
  accountName: string;
  category: PlCategory;
  monthly: Record<MonthKey, number>;
  hasSubaccounts: boolean;
  // Exactly one of these is populated per account:
  subaccounts: PlSubaccountRow[]; // when hasSubaccounts
  customers: PlCustomerRow[];     // when !hasSubaccounts
  avgPrior: number;
  current: number;
  variance: number;
  variancePct: number;
  flagged: boolean;
};

export type PlCategoryGroup = {
  category: PlCategory;
  label: string;
  accounts: PlAccountGroup[];
  monthly: Record<MonthKey, number>;
};

export type ServiceTypeOption = {
  code: string;
  label: string;
};

export type PlComparisonResult = {
  months: MonthKey[]; // 3 months chronological: [-2, -1, current]
  categories: PlCategoryGroup[];
  netIncome: Record<MonthKey, number>;
  threshold: { absolute: number; pct: number };
  availableServiceTypes: ServiceTypeOption[];
  appliedServiceTypes: string[] | null;
};

const CATEGORY_LABELS: Record<PlCategory, string> = {
  Income: "Income",
  CostOfGoodsSold: "Cost of Goods Sold",
  Expense: "Expense",
};

const SERVICE_TYPE_CODE = "SERVICE TYPE";
const SUBACCOUNT_CODE = "SUBACCOUNT";
const UNKNOWN_COUNTERPARTY = "(uncategorized)";
const NO_SUBACCOUNT_LABEL = "(no subaccount)";

function monthRange(endMonth: string): MonthKey[] {
  const [y, m] = endMonth.split("-").map(Number);
  const out: MonthKey[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    );
  }
  return out;
}

function monthBounds(ym: MonthKey): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(first), end: fmt(last) };
}

function isPlCategory(cat: string): cat is PlCategory {
  return cat === "Income" || cat === "CostOfGoodsSold" || cat === "Expense";
}

function plSignedAmount(cat: PlCategory, debit: number, credit: number): number {
  if (cat === "Income") return (credit ?? 0) - (debit ?? 0);
  return (debit ?? 0) - (credit ?? 0);
}

function findDimension(
  lines: BcDimensionLine[] | undefined,
  code: string
): BcDimensionLine | null {
  if (!lines) return null;
  return lines.find((l) => l.code === code) ?? null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyMonthly(months: MonthKey[]): Record<MonthKey, number> {
  return Object.fromEntries(months.map((m) => [m, 0]));
}

function computeThresholdFlags(
  monthly: Record<MonthKey, number>,
  months: MonthKey[],
  threshold: { absolute: number; pct: number }
): {
  avgPrior: number;
  current: number;
  variance: number;
  variancePct: number;
  flagged: boolean;
} {
  const priorCount = months.length - 1;
  const priorKeys = months.slice(0, priorCount);
  const curKey = months[months.length - 1];
  const v = (k: MonthKey) => monthly[k] ?? 0;
  const avgPrior = priorKeys.reduce((sum, k) => sum + v(k), 0) / priorCount;
  const current = v(curKey);
  const variance = current - avgPrior;
  const variancePct = avgPrior === 0 ? 0 : variance / Math.abs(avgPrior);
  const flagged =
    Math.abs(variance) >= threshold.absolute &&
    (avgPrior === 0 || Math.abs(variancePct) >= threshold.pct);
  return {
    avgPrior: round2(avgPrior),
    current: round2(current),
    variance: round2(variance),
    variancePct: Math.round(variancePct * 10000) / 10000,
    flagged,
  };
}

export type PlComparisonOptions = {
  threshold?: { absolute: number; pct: number };
  serviceTypes?: string[] | null;
};

export async function computePlComparison(
  endMonth: string,
  opts: PlComparisonOptions = {}
): Promise<PlComparisonResult> {
  const threshold = opts.threshold ?? { absolute: 500, pct: 0.2 };
  const serviceFilter =
    opts.serviceTypes && opts.serviceTypes.length > 0
      ? new Set(opts.serviceTypes)
      : null;

  const months = monthRange(endMonth);
  const start = monthBounds(months[0]).start;
  const end = monthBounds(months[months.length - 1]).end;

  // Fetch counterparty sources in parallel with account metadata.
  const [allAccounts, salesInvoices, purchaseInvoices] = await Promise.all([
    listAccounts(),
    listSalesInvoices(start, end),
    listPurchaseInvoicesRange(start, end).catch(() => []),
  ]);
  const plAccounts: BcAccount[] = allAccounts.filter((a) => isPlCategory(a.category));
  const accountMeta = new Map<string, BcAccount>(plAccounts.map((a) => [a.number, a]));

  // GL entries must be fetched after we know the P&L account numbers to
  // filter server-side.
  const glEntries = await listGlEntriesRange(
    start,
    end,
    plAccounts.map((a) => a.number)
  );

  // Document-number lookups for counterparty resolution.
  const salesByDoc = new Map<string, string>();
  for (const inv of salesInvoices) {
    if (inv.number) salesByDoc.set(inv.number, inv.customerName || inv.customerNumber || "");
  }
  const purchaseByDoc = new Map<string, string>();
  for (const inv of purchaseInvoices) {
    if (inv.number) purchaseByDoc.set(inv.number, inv.vendorName || inv.vendorNumber || "");
  }

  function resolveCounterparty(cat: PlCategory, documentNumber: string | undefined): string {
    if (!documentNumber) return UNKNOWN_COUNTERPARTY;
    if (cat === "Income") return salesByDoc.get(documentNumber) ?? UNKNOWN_COUNTERPARTY;
    return purchaseByDoc.get(documentNumber) ?? UNKNOWN_COUNTERPARTY;
  }

  // Pass 1: available SERVICE TYPE values (pre-filter).
  const serviceTypeMap = new Map<string, string>();
  for (const e of glEntries) {
    if (!accountMeta.has(e.accountNumber)) continue;
    const st = findDimension(e.dimensionSetLines, SERVICE_TYPE_CODE);
    if (st) serviceTypeMap.set(st.valueCode, st.valueDisplayName || st.valueCode);
  }
  const availableServiceTypes: ServiceTypeOption[] = [...serviceTypeMap.entries()]
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Pass 2: aggregate by (account, subaccount, counterparty) × month.
  // Key: `${accountNumber}||${subaccountCode}||${counterparty}`
  type Bucket = {
    amount: number;
    sub: SubaccountKey | null;
    counterparty: string;
  };
  const agg = new Map<string, Map<MonthKey, Bucket>>();
  const accountHasSubaccount = new Set<string>();

  for (const e of glEntries) {
    const meta = accountMeta.get(e.accountNumber);
    if (!meta) continue;
    const cat = meta.category as PlCategory;
    if (!isPlCategory(cat)) continue;
    const ym = (e.postingDate ?? "").slice(0, 7);
    if (!ym) continue;

    if (serviceFilter) {
      const st = findDimension(e.dimensionSetLines, SERVICE_TYPE_CODE);
      if (!st || !serviceFilter.has(st.valueCode)) continue;
    }

    const subDim = findDimension(e.dimensionSetLines, SUBACCOUNT_CODE);
    const sub: SubaccountKey | null = subDim
      ? { code: subDim.valueCode, label: subDim.valueDisplayName || subDim.valueCode }
      : null;
    if (sub) accountHasSubaccount.add(e.accountNumber);

    const counterparty = resolveCounterparty(cat, e.documentNumber);

    const bucketKey = `${e.accountNumber}||${sub?.code ?? ""}||${counterparty}`;
    let byMonth = agg.get(bucketKey);
    if (!byMonth) {
      byMonth = new Map();
      agg.set(bucketKey, byMonth);
    }
    const existing = byMonth.get(ym) ?? { amount: 0, sub, counterparty };
    existing.amount += plSignedAmount(cat, e.debitAmount ?? 0, e.creditAmount ?? 0);
    byMonth.set(ym, existing);
  }

  // Roll up into account → (subaccount → customers) OR (customers) tree.
  const accountGroups = new Map<string, PlAccountGroup>();
  // Secondary structures while building:
  //   subaccountCustomers[accountNumber][subCode] = Map<counterparty, monthly>
  //   directCustomers[accountNumber] = Map<counterparty, monthly>
  const subaccountCustomers = new Map<
    string,
    Map<string, { label: string; customers: Map<string, Record<MonthKey, number>> }>
  >();
  const directCustomers = new Map<string, Map<string, Record<MonthKey, number>>>();

  for (const [bucketKey, byMonth] of agg.entries()) {
    const [accountNumber, subCode, counterparty] = bucketKey.split("||");
    const meta = accountMeta.get(accountNumber);
    if (!meta) continue;
    const cat = meta.category as PlCategory;

    let group = accountGroups.get(accountNumber);
    if (!group) {
      group = {
        accountNumber,
        accountName: meta.displayName,
        category: cat,
        monthly: emptyMonthly(months),
        hasSubaccounts: accountHasSubaccount.has(accountNumber),
        subaccounts: [],
        customers: [],
        avgPrior: 0,
        current: 0,
        variance: 0,
        variancePct: 0,
        flagged: false,
      };
      accountGroups.set(accountNumber, group);
    }

    // Sum this bucket's monthly amounts into intermediate stores.
    let subLabel: string | null = null;
    const thisMonthly = emptyMonthly(months);
    for (const m of months) {
      const bucket = byMonth.get(m);
      if (bucket) {
        thisMonthly[m] = round2(bucket.amount);
        subLabel = subLabel ?? bucket.sub?.label ?? null;
        group.monthly[m] = round2(group.monthly[m] + bucket.amount);
      }
    }

    if (group.hasSubaccounts) {
      // Even buckets with missing SUBACCOUNT dimension go into a "(no subaccount)" slot.
      const effectiveSubCode = subCode || "__NONE__";
      const effectiveSubLabel = subCode ? (subLabel ?? subCode) : NO_SUBACCOUNT_LABEL;

      let byAccount = subaccountCustomers.get(accountNumber);
      if (!byAccount) {
        byAccount = new Map();
        subaccountCustomers.set(accountNumber, byAccount);
      }
      let bySub = byAccount.get(effectiveSubCode);
      if (!bySub) {
        bySub = { label: effectiveSubLabel, customers: new Map() };
        byAccount.set(effectiveSubCode, bySub);
      }
      const custMonthly = bySub.customers.get(counterparty) ?? emptyMonthly(months);
      for (const m of months) custMonthly[m] = round2(custMonthly[m] + thisMonthly[m]);
      bySub.customers.set(counterparty, custMonthly);
    } else {
      let byCustomer = directCustomers.get(accountNumber);
      if (!byCustomer) {
        byCustomer = new Map();
        directCustomers.set(accountNumber, byCustomer);
      }
      const custMonthly = byCustomer.get(counterparty) ?? emptyMonthly(months);
      for (const m of months) custMonthly[m] = round2(custMonthly[m] + thisMonthly[m]);
      byCustomer.set(counterparty, custMonthly);
    }
  }

  // Finalize subaccount / customer rows on each account.
  for (const g of accountGroups.values()) {
    if (g.hasSubaccounts) {
      const byAccount = subaccountCustomers.get(g.accountNumber);
      if (byAccount) {
        for (const [code, { label, customers }] of byAccount.entries()) {
          const subMonthly = emptyMonthly(months);
          const customerRows: PlCustomerRow[] = [];
          for (const [counterparty, custMonthly] of customers.entries()) {
            for (const m of months) subMonthly[m] = round2(subMonthly[m] + custMonthly[m]);
            const flags = computeThresholdFlags(custMonthly, months, threshold);
            customerRows.push({ counterparty, monthly: custMonthly, ...flags });
          }
          customerRows.sort((a, b) => a.counterparty.localeCompare(b.counterparty));
          const subFlags = computeThresholdFlags(subMonthly, months, threshold);
          g.subaccounts.push({
            subaccount: { code: code === "__NONE__" ? "" : code, label },
            monthly: subMonthly,
            ...subFlags,
            customers: customerRows,
          });
        }
        g.subaccounts.sort((a, b) => a.subaccount.label.localeCompare(b.subaccount.label));
      }
    } else {
      const byCustomer = directCustomers.get(g.accountNumber);
      if (byCustomer) {
        for (const [counterparty, custMonthly] of byCustomer.entries()) {
          const flags = computeThresholdFlags(custMonthly, months, threshold);
          g.customers.push({ counterparty, monthly: custMonthly, ...flags });
        }
        g.customers.sort((a, b) => a.counterparty.localeCompare(b.counterparty));
      }
    }
    const flags = computeThresholdFlags(g.monthly, months, threshold);
    g.avgPrior = flags.avgPrior;
    g.current = flags.current;
    g.variance = flags.variance;
    g.variancePct = flags.variancePct;
    g.flagged = flags.flagged;
  }

  const activeAccounts = [...accountGroups.values()].filter((g) =>
    months.some((m) => Math.abs(g.monthly[m] ?? 0) > 0.005)
  );

  const categoryOrder: PlCategory[] = ["Income", "CostOfGoodsSold", "Expense"];
  const categories: PlCategoryGroup[] = categoryOrder.map((cat) => {
    const accounts = activeAccounts
      .filter((a) => a.category === cat)
      .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
    const monthly = emptyMonthly(months);
    for (const a of accounts) {
      for (const m of months) monthly[m] = round2(monthly[m] + (a.monthly[m] ?? 0));
    }
    return { category: cat, label: CATEGORY_LABELS[cat], accounts, monthly };
  });

  const netIncome = Object.fromEntries(
    months.map((m) => {
      const inc = categories.find((c) => c.category === "Income")?.monthly[m] ?? 0;
      const cogs = categories.find((c) => c.category === "CostOfGoodsSold")?.monthly[m] ?? 0;
      const exp = categories.find((c) => c.category === "Expense")?.monthly[m] ?? 0;
      return [m, round2(inc - cogs - exp)];
    })
  ) as Record<MonthKey, number>;

  return {
    months,
    categories,
    netIncome,
    threshold,
    availableServiceTypes,
    appliedServiceTypes: serviceFilter ? [...serviceFilter] : null,
  };
}
