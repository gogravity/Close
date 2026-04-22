/**
 * Pattern detection for recurring vendor expenses and GL journal entries.
 *
 * Two detection paths:
 *  1. AP vendors   – purchase invoices grouped by vendor name
 *  2. GL journals  – general ledger journal entries grouped by
 *                    account + normalised description
 *
 * Both paths share the same frequency classification (based on how many of
 * the last-6 months in the lookback window the item appeared) and the same
 * "expected this month" logic.
 */

// ── Shared types ──────────────────────────────────────────────────────────────

export type RecurringFrequency = "monthly" | "frequent" | "quarterly" | "occasional";

export type RecurringBase = {
  monthsPresent: number;
  lookbackMonths: number;
  frequency: RecurringFrequency;
  typicalDay: number | null;
  avgMonthlyAmount: number;
  seenInMonths: string[];
  expectedThisMonth: boolean;
};

// ── AP vendor types ───────────────────────────────────────────────────────────

export type RecurringVendor = RecurringBase & {
  source: "ap";
  vendor: string;
};

export type RecentInvoiceMonth = {
  /** YYYY-MM */
  month: string;
  invoices: {
    invoiceNumber: string;
    invoiceDate: string;
    amount: number;
    bcStatus: string;
  }[];
};

export type VerifiedVendor = RecurringVendor & {
  status: "found" | "absent";
  currentMonthInvoices: {
    invoiceNumber: string;
    vendorName: string;
    invoiceDate: string;
    amount: number;
    bcStatus: string;
  }[];
  /** Last 3 months of lookback history, most recent first */
  recentMonths: RecentInvoiceMonth[];
};

// ── GL journal types ──────────────────────────────────────────────────────────

export type RecurringJournalPattern = RecurringBase & {
  source: "gl";
  /** The normalised description used as the grouping key */
  description: string;
  /** Raw description from the most-recent matching entry */
  rawDescription: string;
  accountNumber: string;
  accountName?: string;
};

export type VerifiedJournalPattern = RecurringJournalPattern & {
  status: "found" | "absent";
  currentMonthEntries: {
    postingDate: string;
    description: string;
    debitAmount: number;
    creditAmount: number;
  }[];
};

// ── Possibly-new AP vendor ────────────────────────────────────────────────────

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

// ── Possibly-new GL pattern ───────────────────────────────────────────────────

export type PossiblyNewGlPattern = {
  accountNumber: string;
  description: string;
  rawDescription: string;
  totalDebit: number;
  currentMonthEntries: {
    postingDate: string;
    description: string;
    debitAmount: number;
    creditAmount: number;
  }[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strip month names, years, and trailing punctuation for grouping. */
export function normalizeDescription(desc: string): string {
  return (desc ?? "")
    .replace(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/gi,
      ""
    )
    .replace(/\b20\d{2}\b/g, "")
    .replace(/[-–]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Classify frequency using appearances in the last 6 months of the lookback. */
function classifyFrequency(
  seenInMonths: string[],
  lookbackEndYM: string
): RecurringFrequency {
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

function medianDay(days: number[]): number | null {
  if (days.length === 0) return null;
  const sorted = [...days].sort((a, b) => a - b);
  const spread = sorted[sorted.length - 1] - sorted[0];
  return spread <= 14 ? sorted[Math.floor(sorted.length / 2)] : null;
}

// ── AP vendor detection ───────────────────────────────────────────────────────

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
  const byVendor = new Map<
    string,
    { months: Map<string, number>; days: number[] }
  >();

  for (const inv of invoices) {
    const ym = inv.invoiceDate?.slice(0, 7);
    const day = parseInt(inv.invoiceDate?.slice(8, 10) ?? "0", 10);
    const vendor = inv.vendorName?.trim();
    if (!vendor || !ym || ym.length < 7) continue;

    if (!byVendor.has(vendor))
      byVendor.set(vendor, { months: new Map(), days: [] });
    const d = byVendor.get(vendor)!;
    d.months.set(ym, (d.months.get(ym) ?? 0) + (inv.totalAmountIncludingTax ?? 0));
    if (day > 0) d.days.push(day);
  }

  const results: RecurringVendor[] = [];
  for (const [vendor, { months, days }] of byVendor) {
    const monthsPresent = months.size;
    if (monthsPresent < minMonths) continue;

    const seenInMonths = [...months.keys()].sort();
    const totalAmount = [...months.values()].reduce((s, v) => s + v, 0);

    results.push({
      source: "ap",
      vendor,
      monthsPresent,
      lookbackMonths,
      frequency: classifyFrequency(seenInMonths, lookbackEndYM),
      typicalDay: medianDay(days),
      avgMonthlyAmount: totalAmount / monthsPresent,
      seenInMonths,
      expectedThisMonth: false, // refined below
    });
  }

  return results
    .map((r) => ({
      ...r,
      expectedThisMonth:
        r.frequency === "monthly" || r.frequency === "frequent",
    }))
    .sort((a, b) =>
      b.monthsPresent !== a.monthsPresent
        ? b.monthsPresent - a.monthsPresent
        : b.avgMonthlyAmount - a.avgMonthlyAmount
    );
}

// ── GL journal detection ──────────────────────────────────────────────────────

/**
 * Detect recurring patterns from GL journal entries.
 *
 * Only entries with documentType blank / "_x0020_" are considered —
 * Invoice and Payment entries are excluded (invoices are already caught by
 * the AP path; payments are financial movements).
 */
export function detectRecurringGlPatterns(
  entries: {
    postingDate: string;
    documentType: string;
    accountNumber: string;
    description: string;
    debitAmount: number;
    creditAmount: number;
  }[],
  lookbackMonths: number,
  lookbackEndYM: string,
  minMonths = 2
): RecurringJournalPattern[] {
  // Journal entries only — exclude Invoice, Payment, Credit Memo
  const EXCLUDED_TYPES = new Set(["Invoice", "Payment", "Credit_x0020_Memo"]);

  const byKey = new Map<
    string,
    {
      accountNumber: string;
      norm: string;
      rawDescription: string;
      months: Map<string, number>; // ym → total debit
      days: number[];
    }
  >();

  for (const e of entries) {
    const docType = e.documentType ?? "";
    if (EXCLUDED_TYPES.has(docType)) continue;

    const desc = (e.description ?? "").trim();
    // Skip UUID descriptions (system-generated, not human-readable)
    if (UUID_RE.test(desc)) continue;
    // Skip very short descriptions
    if (desc.length < 4) continue;

    const ym = e.postingDate?.slice(0, 7);
    if (!ym || ym.length < 7) continue;

    const norm = normalizeDescription(desc);
    if (!norm || norm.length < 3) continue;

    const key = `${e.accountNumber}|${norm}`;
    if (!byKey.has(key))
      byKey.set(key, {
        accountNumber: e.accountNumber,
        norm,
        rawDescription: desc,
        months: new Map(),
        days: [],
      });

    const d = byKey.get(key)!;
    d.months.set(ym, (d.months.get(ym) ?? 0) + (e.debitAmount ?? 0));
    const day = parseInt(e.postingDate?.slice(8, 10) ?? "0", 10);
    if (day > 0) d.days.push(day);
    // Keep the most recent raw description
    if (ym > (d.rawDescription ? ym : "")) d.rawDescription = desc;
  }

  const results: RecurringJournalPattern[] = [];
  for (const [, d] of byKey) {
    const monthsPresent = d.months.size;
    if (monthsPresent < minMonths) continue;

    const seenInMonths = [...d.months.keys()].sort();
    const totalAmount = [...d.months.values()].reduce((s, v) => s + v, 0);
    const frequency = classifyFrequency(seenInMonths, lookbackEndYM);

    results.push({
      source: "gl",
      accountNumber: d.accountNumber,
      description: d.norm,
      rawDescription: d.rawDescription,
      monthsPresent,
      lookbackMonths,
      frequency,
      typicalDay: medianDay(d.days),
      avgMonthlyAmount: totalAmount / monthsPresent,
      seenInMonths,
      expectedThisMonth: frequency === "monthly" || frequency === "frequent",
    });
  }

  return results.sort((a, b) =>
    b.monthsPresent !== a.monthsPresent
      ? b.monthsPresent - a.monthsPresent
      : b.avgMonthlyAmount - a.avgMonthlyAmount
  );
}

// ── Cross-reference ───────────────────────────────────────────────────────────

/**
 * Cross-reference recurring AP vendors against the current month.
 * Returns verified vendors (with recent 3-month history attached) and
 * vendors appearing for the first time this month.
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
  verifyMonth: number,
  /** Raw lookback invoices — used to build per-vendor 3-month history */
  lookbackInvoices: {
    number: string;
    invoiceDate: string;
    vendorName: string;
    totalAmountIncludingTax: number;
    status: string;
  }[],
  /** Last 3 YYYY-MM strings of the lookback window, most-recent first */
  recentMonthsYM: string[]
): { verified: VerifiedVendor[]; possiblyNew: PossiblyNewVendor[] } {
  const knownVendors = new Set(recurring.map((r) => r.vendor.toLowerCase()));

  const currentByVendor = new Map<string, typeof currentMonthInvoices>();
  for (const inv of currentMonthInvoices) {
    const key = inv.vendorName?.trim().toLowerCase() ?? "";
    if (!currentByVendor.has(key)) currentByVendor.set(key, []);
    currentByVendor.get(key)!.push(inv);
  }

  // Build recent-history lookup: vendorKey → month → invoices[]
  const recentSet = new Set(recentMonthsYM);
  const historyByVendor = new Map<string, Map<string, RecentInvoiceMonth["invoices"]>>();
  for (const inv of lookbackInvoices) {
    const ym = inv.invoiceDate?.slice(0, 7);
    if (!ym || !recentSet.has(ym)) continue;
    const key = inv.vendorName?.trim().toLowerCase() ?? "";
    if (!historyByVendor.has(key)) historyByVendor.set(key, new Map());
    const byMonth = historyByVendor.get(key)!;
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym)!.push({
      invoiceNumber: inv.number,
      invoiceDate: inv.invoiceDate,
      amount: inv.totalAmountIncludingTax,
      bcStatus: inv.status,
    });
  }

  const verified: VerifiedVendor[] = recurring.map((r) => {
    let expectedThisMonth = r.expectedThisMonth;
    if (!expectedThisMonth && r.frequency === "quarterly") {
      const seenNums = r.seenInMonths.map((ym) =>
        parseInt(ym.slice(5, 7), 10)
      );
      expectedThisMonth = seenNums.some((m) => m % 3 === verifyMonth % 3);
    }
    const matches = currentByVendor.get(r.vendor.toLowerCase()) ?? [];

    // Build recent months from lookback, most-recent first
    const byMonth = historyByVendor.get(r.vendor.toLowerCase());
    const recentMonths: RecentInvoiceMonth[] = recentMonthsYM
      .filter((ym) => byMonth?.has(ym))
      .map((ym) => ({ month: ym, invoices: byMonth!.get(ym)! }));

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
      recentMonths,
    };
  });

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

/**
 * Cross-reference recurring GL patterns against the current month.
 * Also surfaces GL entries in the current month that don't match any known
 * pattern (possible new recurring items like rent from a new location).
 */
export function crossReferenceGlPatterns(
  patterns: RecurringJournalPattern[],
  currentEntries: {
    postingDate: string;
    documentType: string;
    accountNumber: string;
    description: string;
    debitAmount: number;
    creditAmount: number;
  }[],
  verifyMonth: number
): { verified: VerifiedJournalPattern[]; possiblyNew: PossiblyNewGlPattern[] } {
  const EXCLUDED = ["Invoice", "Payment", "Credit_x0020_Memo"];

  // Build lookup by accountNumber + normalised description
  const currentByKey = new Map<
    string,
    {
      accountNumber: string;
      norm: string;
      rawDescription: string;
      entries: typeof currentEntries;
    }
  >();

  for (const e of currentEntries) {
    if (EXCLUDED.includes(e.documentType ?? "")) continue;
    const desc = (e.description ?? "").trim();
    if (UUID_RE.test(desc) || desc.length < 4) continue;
    const norm = normalizeDescription(desc);
    if (!norm || norm.length < 3) continue;
    const key = `${e.accountNumber}|${norm}`;
    if (!currentByKey.has(key)) {
      currentByKey.set(key, {
        accountNumber: e.accountNumber,
        norm,
        rawDescription: desc,
        entries: [],
      });
    }
    currentByKey.get(key)!.entries.push(e);
  }

  // Known pattern keys
  const knownKeys = new Set(patterns.map((p) => `${p.accountNumber}|${p.description}`));

  // Verified patterns
  const verified: VerifiedJournalPattern[] = patterns.map((p): VerifiedJournalPattern => {
    let expectedThisMonth = p.expectedThisMonth;
    if (!expectedThisMonth && p.frequency === "quarterly") {
      const seenNums = p.seenInMonths.map((ym) =>
        parseInt(ym.slice(5, 7), 10)
      );
      expectedThisMonth = seenNums.some((m) => m % 3 === verifyMonth % 3);
    }
    const key = `${p.accountNumber}|${p.description}`;
    const bucket = currentByKey.get(key);
    const matches = bucket?.entries ?? [];
    return {
      ...p,
      expectedThisMonth,
      status: matches.length > 0 ? "found" : "absent",
      currentMonthEntries: matches.map((e) => ({
        postingDate: e.postingDate,
        description: e.description,
        debitAmount: e.debitAmount,
        creditAmount: e.creditAmount,
      })),
    };
  });

  // Possibly-new GL patterns: current-month entries not matching any known pattern
  const possiblyNew: PossiblyNewGlPattern[] = [];
  for (const [key, bucket] of currentByKey) {
    if (knownKeys.has(key)) continue;
    possiblyNew.push({
      accountNumber: bucket.accountNumber,
      description: bucket.norm,
      rawDescription: bucket.rawDescription,
      totalDebit: bucket.entries.reduce((s, e) => s + (e.debitAmount ?? 0), 0),
      currentMonthEntries: bucket.entries.map((e) => ({
        postingDate: e.postingDate,
        description: e.description,
        debitAmount: e.debitAmount,
        creditAmount: e.creditAmount,
      })),
    });
  }
  possiblyNew.sort((a, b) => b.totalDebit - a.totalDebit);

  return { verified, possiblyNew };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

export function monthBounds(
  year: number,
  month: number
): { start: string; end: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function subtractMonths(
  year: number,
  month: number,
  n: number
): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 - n, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}
