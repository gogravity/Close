import { NextResponse } from "next/server";
import { listPurchaseInvoicesRange, BusinessCentralError } from "@/lib/businessCentral";
import {
  detectRecurringVendors,
  crossReferenceMonth,
  monthBounds,
  subtractMonths,
  type VerifiedVendor,
} from "@/lib/recurringExpenses";

export const dynamic = "force-dynamic";

export type ChecklistResponse = {
  ok: true;
  year: number;
  month: number;
  periodLabel: string;
  lookbackMonths: number;
  lookbackStart: string;
  totalTracked: number;
  found: number;
  absentExpected: number;
  absentNotExpected: number;
  vendors: VerifiedVendor[];
};

export type ChecklistErrorResponse = {
  ok: false;
  error: string;
};

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");
  const lookbackParam = searchParams.get("lookback");

  const now = new Date();
  const year = yearParam ? parseInt(yearParam, 10) : now.getUTCFullYear();
  const month = monthParam ? parseInt(monthParam, 10) : now.getUTCMonth() + 1;
  const lookbackMonths = lookbackParam ? Math.min(parseInt(lookbackParam, 10), 24) : 6;

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return NextResponse.json<ChecklistErrorResponse>(
      { ok: false, error: "Invalid year or month" },
      { status: 400 }
    );
  }

  const periodLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  try {
    // ── Lookback window ────────────────────────────────────────────────────────
    // Fetch the N months immediately before the verification month.
    const lookbackEnd = subtractMonths(year, month, 1);
    const lookbackStart = subtractMonths(year, month, lookbackMonths);

    const lbStartBounds = monthBounds(lookbackStart.year, lookbackStart.month);
    const lbEndBounds = monthBounds(lookbackEnd.year, lookbackEnd.month);

    // ── Verification month ─────────────────────────────────────────────────────
    const verifyBounds = monthBounds(year, month);

    // Fetch both ranges in parallel
    const [lookbackInvoices, currentInvoices] = await Promise.all([
      listPurchaseInvoicesRange(lbStartBounds.start, lbEndBounds.end),
      listPurchaseInvoicesRange(verifyBounds.start, verifyBounds.end),
    ]);

    // ── Pattern detection ──────────────────────────────────────────────────────
    const recurring = detectRecurringVendors(lookbackInvoices, lookbackMonths, 2);
    const mappedCurrent = currentInvoices.map((inv) => ({
      invoiceNumber: inv.number,
      invoiceDate: inv.invoiceDate,
      vendorName: inv.vendorName,
      totalAmountIncludingTax: inv.totalAmountIncludingTax,
      status: inv.status,
    }));
    const verified = crossReferenceMonth(recurring, mappedCurrent, month);

    const found = verified.filter((v) => v.status === "found").length;
    const absentExpected = verified.filter(
      (v) => v.status === "absent" && v.expectedThisMonth
    ).length;
    const absentNotExpected = verified.filter(
      (v) => v.status === "absent" && !v.expectedThisMonth
    ).length;

    return NextResponse.json<ChecklistResponse>({
      ok: true,
      year,
      month,
      periodLabel,
      lookbackMonths,
      lookbackStart: lbStartBounds.start,
      totalTracked: verified.length,
      found,
      absentExpected,
      absentNotExpected,
      vendors: verified,
    });
  } catch (err) {
    const msg =
      err instanceof BusinessCentralError
        ? `BC ${err.status}: ${err.message}`
        : (err as Error).message;
    return NextResponse.json<ChecklistErrorResponse>({ ok: false, error: msg }, { status: 500 });
  }
}
