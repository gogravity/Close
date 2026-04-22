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

/**
 * From a flat list of invoices, detect vendors with recurring patterns.
 *
 * @param invoices  All invoices in the lookback window (NOT including the
 *                  verification month itself).
 * @param lookbackMonths  Number of calendar months in the window (for ratio
 *                        calculations). Pass the actual count, not inferred.
 * @param minMonths  Minimum months a vendor must appear to be considered
 *                   recurring (default 2).
 */
export function detectRecurringVendors(
  invoices: {
    invoiceDate: string;
    vendorName: string;
    totalAmountIncludingTax: number;
  }[],
  lookbackMonths: number,
  minMonths = 2
): RecurringVendor[] {
  // Aggregate per vendor → month
  const byVendor = new Map<
    string,
    { months: Map<string, number>; days: number[] }
  >();

  for (const inv of invoices) {
    const ym = inv.invoiceDate.slice(0, 7);
    const day = parseInt(inv.invoiceDate.slice(8, 10), 10);
    const amount = inv.totalAmountIncludingTax ?? 0;
    const vendor = inv.vendorName?.trim();
    if (!vendor || !ym) continue;

    if (!byVendor.has(vendor)) byVendor.set(vendor, { months: new Map(), days: [] });
    const d = byVendor.get(vendor)!;
    d.months.set(ym, (d.months.get(ym) ?? 0) + amount);
    d.days.push(day);
  }

  const results: RecurringVendor[] = [];

  for (const [vendor, { months, days }] of byVendor) {
    const monthsPresent = months.size;
    if (monthsPresent < minMonths) continue;

    const ratio = monthsPresent / lookbackMonths;
    let frequency: RecurringFrequency;
    if (ratio >= 0.75) frequency = "monthly";
    else if (ratio >= 0.45) frequency = "frequent";
    else if (ratio >= 0.2) frequency = "quarterly";
    else frequency = "occasional";

    const seenInMonths = [...months.keys()].sort();
    const totalAmount = [...months.values()].reduce((s, v) => s + v, 0);
    const avgMonthlyAmount = totalAmount / monthsPresent;

    // Median day of month
    const sortedDays = [...days].sort((a, b) => a - b);
    const medDay = sortedDays[Math.floor(sortedDays.length / 2)];
    // Only report a typical day if the spread is tight (±7 days)
    const spread = sortedDays[sortedDays.length - 1] - sortedDays[0];
    const typicalDay = spread <= 14 ? medDay : null;

    // Determine if expected this month: monthly/frequent → always yes.
    // Quarterly/occasional → yes only if the verification month number
    // matches one of the months they appeared in (mod-3 or mod-6 check).
    // We compute this later when we have the verification month; for now mark
    // monthly/frequent as always expected.
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

  // Sort: most-frequent first, then by avg amount descending
  return results.sort((a, b) => {
    if (b.monthsPresent !== a.monthsPresent) return b.monthsPresent - a.monthsPresent;
    return b.avgMonthlyAmount - a.avgMonthlyAmount;
  });
}

/**
 * Given detected recurring vendors and the invoices for the verification
 * month, cross-reference to produce a "verified" list with status.
 *
 * Also refines `expectedThisMonth` for quarterly/occasional vendors by
 * checking if the verification month number matches their historical pattern.
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
  verifyMonth: number // 1-12
): VerifiedVendor[] {
  // Build vendor → current-month invoices lookup (case-insensitive)
  const currentByVendor = new Map<string, typeof currentMonthInvoices>();
  for (const inv of currentMonthInvoices) {
    const key = inv.vendorName?.trim().toLowerCase() ?? "";
    if (!currentByVendor.has(key)) currentByVendor.set(key, []);
    currentByVendor.get(key)!.push(inv);
  }

  return recurring.map((r): VerifiedVendor => {
    // Refine expectedThisMonth for quarterly/occasional
    let expectedThisMonth = r.expectedThisMonth;
    if (!expectedThisMonth) {
      // Check if any of the months they historically appeared in share the
      // same remainder mod 3 (quarterly) or mod 6 (semi-annual)
      const seenMonthNums = r.seenInMonths.map((ym) => parseInt(ym.slice(5, 7), 10));
      if (r.frequency === "quarterly") {
        expectedThisMonth = seenMonthNums.some((m) => m % 3 === verifyMonth % 3);
      } else {
        // occasional — show but don't expect
        expectedThisMonth = false;
      }
    }

    const key = r.vendor.toLowerCase();
    const matches = currentByVendor.get(key) ?? [];
    const found = matches.length > 0;

    return {
      ...r,
      expectedThisMonth,
      status: found ? "found" : "absent",
      currentMonthInvoices: matches.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        vendorName: inv.vendorName,
        invoiceDate: inv.invoiceDate,
        amount: inv.totalAmountIncludingTax,
        bcStatus: inv.status,
      })),
    };
  });
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
