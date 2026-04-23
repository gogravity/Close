import Link from "next/link";
import { redirect } from "next/navigation";
import { getEntityConfig } from "@/lib/settings";
import {
  listSalesInvoicesWithLines,
  listSalesCreditMemosWithLines,
  listCustomersForTax,
  listTaxAreas,
  listTaxGroups,
  BusinessCentralError,
} from "@/lib/businessCentral";
import SalesTaxClient, { type TaxTransactionRow } from "./SalesTaxClient";

export const dynamic = "force-dynamic";

function periodStartOf(periodEnd: string): string {
  const d = new Date(periodEnd);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export default async function SalesTaxPage() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured) redirect("/onboarding");

  const periodEnd = entity.periodEnd;
  const periodStart = periodStartOf(periodEnd);

  try {
    const [invoices, creditMemos, customers, taxAreas, taxGroups] = await Promise.all([
      listSalesInvoicesWithLines(periodStart, periodEnd).catch(() => []),
      listSalesCreditMemosWithLines(periodStart, periodEnd).catch(() => []),
      listCustomersForTax().catch(() => []),
      listTaxAreas().catch(() => []),
      listTaxGroups().catch(() => []),
    ]);

    const customerById = new Map(customers.map((c) => [c.id, c]));
    const customerByNumber = new Map(customers.map((c) => [c.number, c]));

    const rows: TaxTransactionRow[] = [];

    for (const inv of invoices) {
      const cust =
        customerById.get(inv.customerId ?? "") ??
        customerByNumber.get(inv.customerNumber ?? "");
      const state = cust?.state ?? "";
      const city = cust?.city ?? "";
      for (const line of inv.salesInvoiceLines ?? []) {
        const tax = Number(line.totalTaxAmount ?? 0);
        const taxable = Number(line.amountExcludingTax ?? 0);
        if (tax === 0 && taxable === 0) continue;
        rows.push({
          docType: "Invoice",
          docId: inv.id,
          docNumber: inv.number,
          docDate: inv.invoiceDate,
          customerId: inv.customerId ?? cust?.id ?? "",
          customerNumber: inv.customerNumber ?? cust?.number ?? "",
          customerName: inv.customerName ?? cust?.displayName ?? "",
          state,
          city,
          taxAreaId: cust?.taxAreaId ?? "",
          taxAreaDisplayName: cust?.taxAreaDisplayName ?? "",
          taxCode: line.taxCode ?? "",
          taxPercent: Number(line.taxPercent ?? 0),
          taxableAmount: taxable,
          taxAmount: tax,
          description: line.description ?? "",
        });
      }
    }

    for (const cm of creditMemos) {
      const cust =
        customerById.get(cm.customerId ?? "") ??
        customerByNumber.get(cm.customerNumber ?? "");
      const state = cust?.state ?? "";
      const city = cust?.city ?? "";
      for (const line of cm.salesCreditMemoLines ?? []) {
        const tax = -Number(line.totalTaxAmount ?? 0);
        const taxable = -Number(line.amountExcludingTax ?? 0);
        if (tax === 0 && taxable === 0) continue;
        rows.push({
          docType: "Credit Memo",
          docId: cm.id,
          docNumber: cm.number,
          docDate: cm.invoiceDate ?? cm.postingDate ?? "",
          customerId: cm.customerId ?? cust?.id ?? "",
          customerNumber: cm.customerNumber ?? cust?.number ?? "",
          customerName: cm.customerName ?? cust?.displayName ?? "",
          state,
          city,
          taxAreaId: cust?.taxAreaId ?? "",
          taxAreaDisplayName: cust?.taxAreaDisplayName ?? "",
          taxCode: line.taxCode ?? "",
          taxPercent: Number(line.taxPercent ?? 0),
          taxableAmount: taxable,
          taxAmount: tax,
          description: line.description ?? "",
        });
      }
    }

    return (
      <div className="px-8 py-8 max-w-6xl">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
          ← Balance Sheet Summary
        </Link>
        <header className="mt-3 mb-5">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Data Preparation
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Sales Tax</h1>
          <p className="mt-1 text-sm text-slate-600">
            Collected sales tax for {periodStart} through {periodEnd}, grouped by state,
            tax code, and customer. Includes credit memos (as offsets).
          </p>
        </header>

        <SalesTaxClient
          periodStart={periodStart}
          periodEnd={periodEnd}
          rows={rows}
          taxAreas={taxAreas.map((a) => ({
            code: a.code,
            displayName: a.displayName,
          }))}
          taxGroups={taxGroups.map((g) => ({
            code: g.code,
            displayName: g.displayName,
            taxType: g.taxType ?? "",
          }))}
        />
      </div>
    );
  } catch (err) {
    if (err instanceof BusinessCentralError) {
      return (
        <div className="px-8 py-10 max-w-3xl">
          <h1 className="text-xl font-semibold text-red-700">BC fetch failed</h1>
          <pre className="mt-3 rounded bg-slate-100 p-3 text-xs overflow-auto">
            {err.message}
            {err.body ? `\n\n${JSON.stringify(err.body, null, 2)}` : ""}
          </pre>
        </div>
      );
    }
    throw err;
  }
}
