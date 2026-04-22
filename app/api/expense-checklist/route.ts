import { NextResponse } from "next/server";
import { listPurchaseInvoicesRange, BusinessCentralError } from "@/lib/businessCentral";
import { EXPENSE_CHECKLIST, isExpectedThisMonth, type ExpenseItem } from "@/lib/expenseChecklist";

export const dynamic = "force-dynamic";

export type ChecklistItemResult = {
  item: ExpenseItem;
  /** "found" | "missing" | "not-expected" | "informational" */
  status: "found" | "missing" | "not-expected" | "informational";
  /** BC invoices that matched this vendor for the period */
  matches: {
    invoiceNumber: string;
    vendorName: string;
    invoiceDate: string;
    amount: number;
    bcStatus: string;
  }[];
};

export type ChecklistResponse = {
  ok: true;
  year: number;
  month: number;
  periodLabel: string;
  totalItems: number;
  found: number;
  missing: number;
  notExpected: number;
  results: ChecklistItemResult[];
};

export type ChecklistErrorResponse = {
  ok: false;
  error: string;
};

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");

  const year = yearParam ? parseInt(yearParam, 10) : new Date().getUTCFullYear();
  const month = monthParam ? parseInt(monthParam, 10) : new Date().getUTCMonth() + 1;

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return NextResponse.json<ChecklistErrorResponse>(
      { ok: false, error: "Invalid year or month" },
      { status: 400 }
    );
  }

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  // Last day of month
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const periodLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  try {
    const invoices = await listPurchaseInvoicesRange(startDate, endDate);

    const results: ChecklistItemResult[] = EXPENSE_CHECKLIST.map((item) => {
      // Find matching invoices: any search term is a case-insensitive substring of vendorName
      const matches = invoices
        .filter((inv) =>
          item.searchTerms.some((term) =>
            inv.vendorName.toLowerCase().includes(term.toLowerCase())
          )
        )
        .map((inv) => ({
          invoiceNumber: inv.number,
          vendorName: inv.vendorName,
          invoiceDate: inv.invoiceDate,
          amount: inv.totalAmountIncludingTax,
          bcStatus: inv.status,
        }));

      const found = matches.length > 0;
      const expected = isExpectedThisMonth(item, month);

      let status: ChecklistItemResult["status"];
      if (found) {
        status = "found";
      } else if (item.frequency === "various") {
        status = "informational";
      } else if (expected) {
        status = "missing";
      } else {
        status = "not-expected";
      }

      return { item, status, matches };
    });

    const foundCount = results.filter((r) => r.status === "found").length;
    const missingCount = results.filter((r) => r.status === "missing").length;
    const notExpectedCount = results.filter(
      (r) => r.status === "not-expected" || r.status === "informational"
    ).length;

    return NextResponse.json<ChecklistResponse>({
      ok: true,
      year,
      month,
      periodLabel,
      totalItems: results.length,
      found: foundCount,
      missing: missingCount,
      notExpected: notExpectedCount,
      results,
    });
  } catch (err) {
    const msg =
      err instanceof BusinessCentralError
        ? `BC ${err.status}: ${err.message}`
        : (err as Error).message;
    return NextResponse.json<ChecklistErrorResponse>({ ok: false, error: msg }, { status: 500 });
  }
}
