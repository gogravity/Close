import { NextResponse } from "next/server";
import {
  listPurchaseInvoicesRange,
  listGlEntriesRange,
  BusinessCentralError,
} from "@/lib/businessCentral";
import {
  detectRecurringVendors,
  detectRecurringGlPatterns,
  crossReferenceMonth,
  crossReferenceGlPatterns,
  monthBounds,
  subtractMonths,
  type VerifiedVendor,
  type VerifiedJournalPattern,
  type PossiblyNewVendor,
  type PossiblyNewGlPattern,
} from "@/lib/recurringExpenses";

export const dynamic = "force-dynamic";

export type ChecklistResponse = {
  ok: true;
  year: number;
  month: number;
  periodLabel: string;
  lookbackMonths: number;
  lookbackStart: string;
  /** Last month of lookback window (YYYY-MM), for dot alignment in UI */
  lookbackEndYM: string;
  totalTracked: number;
  found: number;
  absentExpected: number;
  absentNotExpected: number;
  vendors: VerifiedVendor[];
  /** AP vendors appearing in the verification month but absent from lookback history */
  possiblyNew: PossiblyNewVendor[];
  /** GL journal patterns (payroll, rent accruals, etc.) */
  journalPatterns: VerifiedJournalPattern[];
  /** GL entries in current month that don't match any known recurring pattern */
  possiblyNewGl: PossiblyNewGlPattern[];
};

export type ChecklistErrorResponse = {
  ok: false;
  error: string;
};

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  const yearParam     = searchParams.get("year");
  const monthParam    = searchParams.get("month");
  const lookbackParam = searchParams.get("lookback");
  const accountsParam = searchParams.get("accounts"); // comma-separated account numbers

  const now   = new Date();
  const year  = yearParam  ? parseInt(yearParam,  10) : now.getUTCFullYear();
  const month = monthParam ? parseInt(monthParam, 10) : now.getUTCMonth() + 1;
  const lookbackMonths = lookbackParam
    ? Math.min(parseInt(lookbackParam, 10), 24)
    : 6;

  // Account numbers to scan for GL patterns (empty = no GL scan)
  const accountNumbers: string[] = accountsParam
    ? accountsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return NextResponse.json<ChecklistErrorResponse>(
      { ok: false, error: "Invalid year or month" },
      { status: 400 }
    );
  }

  const periodLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });

  try {
    // Lookback window: N months immediately before the verification month
    const lookbackEndMY   = subtractMonths(year, month, 1);
    const lookbackStartMY = subtractMonths(year, month, lookbackMonths);

    const lbStart = monthBounds(lookbackStartMY.year, lookbackStartMY.month);
    const lbEnd   = monthBounds(lookbackEndMY.year,   lookbackEndMY.month);
    const verify  = monthBounds(year, month);

    const lookbackEndYM =
      `${String(lookbackEndMY.year)}-${String(lookbackEndMY.month).padStart(2, "0")}`;

    // Last 3 months of the lookback window (for per-vendor invoice history)
    const recentMonthsYM: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const m = subtractMonths(year, month, i);
      recentMonthsYM.push(`${m.year}-${String(m.month).padStart(2, "0")}`);
    }

    // Fetch AP + GL in parallel
    const apLookbackP = listPurchaseInvoicesRange(lbStart.start, lbEnd.end);
    const apCurrentP  = listPurchaseInvoicesRange(verify.start,  verify.end);
    const glLookbackP = accountNumbers.length > 0
      ? listGlEntriesRange(lbStart.start, lbEnd.end,  accountNumbers)
      : Promise.resolve([]);
    const glCurrentP  = accountNumbers.length > 0
      ? listGlEntriesRange(verify.start,  verify.end, accountNumbers)
      : Promise.resolve([]);

    const [lookbackInvoices, currentInvoices, lookbackGlEntries, currentGlEntries] =
      await Promise.all([apLookbackP, apCurrentP, glLookbackP, glCurrentP]);

    // ── AP vendor path ────────────────────────────────────────────────────────
    const recurring = detectRecurringVendors(
      lookbackInvoices,
      lookbackMonths,
      lookbackEndYM,
      2
    );

    const mappedCurrent = currentInvoices.map((inv) => ({
      invoiceNumber: inv.number,
      invoiceDate:   inv.invoiceDate,
      vendorName:    inv.vendorName,
      totalAmountIncludingTax: inv.totalAmountIncludingTax,
      status:        inv.status,
    }));

    const { verified, possiblyNew } = crossReferenceMonth(
      recurring,
      mappedCurrent,
      month,
      lookbackInvoices,
      recentMonthsYM
    );

    const found             = verified.filter((v) => v.status === "found").length;
    const absentExpected    = verified.filter((v) => v.status === "absent" && v.expectedThisMonth).length;
    const absentNotExpected = verified.filter((v) => v.status === "absent" && !v.expectedThisMonth).length;

    // ── GL journal path ───────────────────────────────────────────────────────
    const glPatterns = accountNumbers.length > 0
      ? detectRecurringGlPatterns(lookbackGlEntries, lookbackMonths, lookbackEndYM, 2)
      : [];

    const { verified: journalPatterns, possiblyNew: possiblyNewGl } =
      accountNumbers.length > 0
        ? crossReferenceGlPatterns(glPatterns, currentGlEntries, month)
        : { verified: [] as VerifiedJournalPattern[], possiblyNew: [] as PossiblyNewGlPattern[] };

    return NextResponse.json<ChecklistResponse>({
      ok: true,
      year,
      month,
      periodLabel,
      lookbackMonths,
      lookbackStart: lbStart.start,
      lookbackEndYM,
      totalTracked: verified.length,
      found,
      absentExpected,
      absentNotExpected,
      vendors: verified,
      possiblyNew,
      journalPatterns,
      possiblyNewGl,
    });
  } catch (err) {
    const msg = err instanceof BusinessCentralError
      ? `BC ${err.status}: ${err.message}`
      : (err as Error).message;
    return NextResponse.json<ChecklistErrorResponse>({ ok: false, error: msg }, { status: 500 });
  }
}
