import { NextResponse } from "next/server";
import { listPurchaseInvoicesRange, BusinessCentralError } from "@/lib/businessCentral";
import {
  detectRecurringVendors,
  crossReferenceMonth,
  monthBounds,
  subtractMonths,
  type VerifiedVendor,
  type PossiblyNewVendor,
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
  /** Vendors appearing in the verification month but absent from lookback history */
  possiblyNew: PossiblyNewVendor[];
};

export type ChecklistErrorResponse = {
  ok: false;
  error: string;
};

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  const yearParam    = searchParams.get("year");
  const monthParam   = searchParams.get("month");
  const lookbackParam = searchParams.get("lookback");

  const now   = new Date();
  const year  = yearParam  ? parseInt(yearParam, 10)  : now.getUTCFullYear();
  const month = monthParam ? parseInt(monthParam, 10) : now.getUTCMonth() + 1;
  const lookbackMonths = lookbackParam
    ? Math.min(parseInt(lookbackParam, 10), 24)
    : 6;

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
    const lookbackEndMY  = subtractMonths(year, month, 1);
    const lookbackStartMY = subtractMonths(year, month, lookbackMonths);

    const lbStart = monthBounds(lookbackStartMY.year, lookbackStartMY.month);
    const lbEnd   = monthBounds(lookbackEndMY.year,   lookbackEndMY.month);
    const verify  = monthBounds(year, month);

    const lookbackEndYM =
      `${String(lookbackEndMY.year)}-${String(lookbackEndMY.month).padStart(2, "0")}`;

    // Fetch lookback + verification month in parallel
    const [lookbackInvoices, currentInvoices] = await Promise.all([
      listPurchaseInvoicesRange(lbStart.start, lbEnd.end),
      listPurchaseInvoicesRange(verify.start, verify.end),
    ]);

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

    const { verified, possiblyNew } = crossReferenceMonth(recurring, mappedCurrent, month);

    const found           = verified.filter((v) => v.status === "found").length;
    const absentExpected  = verified.filter((v) => v.status === "absent" && v.expectedThisMonth).length;
    const absentNotExpected = verified.filter((v) => v.status === "absent" && !v.expectedThisMonth).length;

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
    });
  } catch (err) {
    const msg = err instanceof BusinessCentralError
      ? `BC ${err.status}: ${err.message}`
      : (err as Error).message;
    return NextResponse.json<ChecklistErrorResponse>({ ok: false, error: msg }, { status: 500 });
  }
}
