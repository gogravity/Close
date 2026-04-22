/**
 * Pattern detection for recurring vendor expenses.
 *
 * Given a list of purchase invoices spanning multiple months, this module
 * identifies vendors that appear consistently enough to be considered
 * "expected" expenses — and classifies their frequency so a verification
 * check can flag missing entries for a given period.
 */

export type RecurringFrequency = "monthly" | "frequent" | "quarterly" | "occasional";

export type RecurringVendor = {
  vendor: string;
  /** How many distinct months this vendor appeared in during the lookback */
  monthsPresent: number;
  /** Total months in the lookback window */
  lookbackMonths: number;
  frequency: RecurringFrequency;
  /** Median day-of-month across all invoices (null if inconsistent) */
  typicalDay: number | null;
  /** Average total amount per month they appear */
  avgMonthlyAmount: number;
  /** Months (YYYY-MM) this vendor appeared in, sorted */
  seenInMonths: string[];
  /** Whether this vendor is expected to appear in the verification month */
  expectedThisMonth: boolean;
};

export type VerifiedVendor = RecurringVendor & {
  /** "found" if there's an invoice in the verification month, otherwise "absent" */
  status: "found" | "absent";
  /** Invoices actually found in the verification month */
  currentMonthInvoices: {
    invoiceNumber: string;
    vendorName: string;
    invoiceDate: string;
    amount: number;
    bcStatus: string;
  }[];
};

/** A vendor seen in the verification month but absent from the lookback history. */
export type PossiblyNewVendor = {
  vendor: string;
  invoices: {
    invoiceNumber: string;
    vendorName: string;
    invoiceDate: string;
    amount: number;
    bcStatus: string;
  }[];
  totalAmount: number;
};

/**
 * Classify frequency based on how many of the most-recent 6 months in the
 * lookback window the vendor appeared in. Using the last 6 months as the
 * reference window keeps labels stable regardless of how far back the
 * lookback extends.
 */
function classifyFrequency(
  seenInMonths: string[],
  lookbackEndYM: string // YYYY-MM of last month in lookback
): RecurringFrequency {
  // Build the last 6 months preceding (and including) lookbackEndYM
  const [ey, em] = lookbackEndYM.split("-").map(Number);
  const last6 = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(ey, em - 1 - i, 1));
    last6.add(d.toISOString().slice(0, 7));
  }
  const recentCount = seenInMonths.filter((ym) => last6.has(ym)).length;

  if (recentCount >= 5) return "monthly";
  if (recentCount >= 3) return "frequent";
  if (seenInMonths.length >= 2) return "quarterly";
  return "occasional";
}

/**
 * From a flat list of invoices, detect vendors with recurring patterns.
 *
 * @param invoices       All invoices in the lookback window (NOT the verification month).
 * @param lookbackMonths Number of calendar months in the window.
 * @param lookbackEndYM  The last month of the lookback window (YYYY-MM), used for
 *                       frequency classification.
 * @param minMonths      Minimum distinct months a vendor must appear in (default 2).
 */
export function detectRecurringVendors(
  invoices: {
    invoiceDate: string;
    vendorName: string;
    totalAmountIncludingTax: number;
  }[],
  lookbackMonths: number,
  lookbackEndYM: string,
  minMonths = 2
): RecurringVendor[] {
  const byVendor = new Map<string, { months: Map<string, number>; days: number[] }>();

  for (const inv of invoices) {
    const ym = inv.invoiceDate?.slice(0, 7);
    const day = parseInt(inv.invoiceDate?.slice(8, 10) ?? "0", 10);
    const amount = inv.totalAmountIncludingTax ?? 0;
    const vendor = inv.vendorName?.trim();
    if (!vendor || !ym || ym.length < 7) continue;

    if (!byVendor.has(vendor)) byVendor.set(vendor, { months: new Map(), days: [] });
    const d = byVendor.get(vendor)!;
    d.months.set(ym, (d.months.get(ym) ?? 0) + amount);
    if (day > 0) d.days.push(day);
  }

  const results: RecurringVendor[] = [];

  for (const [vendor, { months, days }] of byVendor) {
    const monthsPresent = months.size;
    if (monthsPresent < minMonths) continue;

    const seenInMonths = [...months.keys()].sort();
    const frequency = classifyFrequency(seenInMonths, lookbackEndYM);

    const totalAmount = [...months.values()].reduce((s, v) => s + v, 0);
    const avgMonthlyAmount = totalAmount / monthsPresent;

    const sortedDays = [...days].sort((a, b) => a - b);
    const medDay = sortedDays.length > 0 ? sortedDays[Math.floor(sortedDays.length / 2)] : null;
    const spread = sortedDays.length > 1
      ? sortedDays[sortedDays.length - 1] - sortedDays[0]
      : 0;
    const typicalDay = medDay !== null && spread <= 14 ? medDay : null;

    const expectedThisMonth = frequency === "monthly" || frequency === "frequent";

    results.push({
      vendor,
      monthsPresent,
      lookbackMonths,
      frequency,
      typicalDay,
      avgMonthlyAmount,
      seenInMonths,
      expectedThisMonth,
    });
  }

  return results.sort((a, b) => {
    if (b.monthsPresent !== a.monthsPresent) return b.monthsPresent - a.monthsPresent;
    return b.avgMonthlyAmount - a.avgMonthlyAmount;
  });
}

/**
 * Cross-reference detected recurring vendors against the current month's invoices.
 * Also returns vendors that appear in the current month but had no lookback history
 * (possibly new recurring expenses).
 */
export function crossReferenceMonth(
  recurring: RecurringVendor[],
  currentMonthInvoices: {
    invoiceNumber: string;
    invoiceDate: string;
    vendorName: string;
    totalAmountIncludingTax: number;
    status: string;
  }[],
  verifyMonth: number
): { verified: VerifiedVendor[]; possiblyNew: PossiblyNewVendor[] } {
  const knownVendors = new Set(recurring.map((r) => r.vendor.toLowerCase()));

  // Build lookup: vendorKey → current-month invoices
  const currentByVendor = new Map<string, typeof currentMonthInvoices>();
  for (const inv of currentMonthInvoices) {
    const key = inv.vendorName?.trim().toLowerCase() ?? "";
    if (!currentByVendor.has(key)) currentByVendor.set(key, []);
    currentByVendor.get(key)!.push(inv);
  }

  const verified: VerifiedVendor[] = recurring.map((r) => {
    let expectedThisMonth = r.expectedThisMonth;
    if (!expectedThisMonth) {
      const seenMonthNums = r.seenInMonths.map((ym) => parseInt(ym.slice(5, 7), 10));
      if (r.frequency === "quarterly") {
        expectedThisMonth = seenMonthNums.some((m) => m % 3 === verifyMonth % 3);
      }
    }

    const matches = currentByVendor.get(r.vendor.toLowerCase()) ?? [];
    return {
      ...r,
      expectedThisMonth,
      status: matches.length > 0 ? "found" : "absent",
      currentMonthInvoices: matches.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        vendorName: inv.vendorName,
        invoiceDate: inv.invoiceDate,
        amount: inv.totalAmountIncludingTax,
        bcStatus: inv.status,
      })),
    };
  });

  // Vendors in the current month that weren't in the lookback at all
  const possiblyNew: PossiblyNewVendor[] = [];
  for (const [key, invs] of currentByVendor) {
    if (knownVendors.has(key)) continue;
    possiblyNew.push({
      vendor: invs[0].vendorName,
      invoices: invs.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        vendorName: inv.vendorName,
        invoiceDate: inv.invoiceDate,
        amount: inv.totalAmountIncludingTax,
        bcStatus: inv.status,
      })),
      totalAmount: invs.reduce((s, i) => s + i.totalAmountIncludingTax, 0),
    });
  }
  possiblyNew.sort((a, b) => b.totalAmount - a.totalAmount);

  return { verified, possiblyNew };
}

/** Build the YYYY-MM-DD start and end dates for a given year/month. */
export function monthBounds(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** Subtract `n` months from year/month, returning the result. */
export function subtractMonths(
  year: number,
  month: number,
  n: number
): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 - n, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}
