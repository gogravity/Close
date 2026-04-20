import { getEntityConfig } from "@/lib/settings";
import InvoiceValidationClient from "./InvoiceValidationClient";

export const dynamic = "force-dynamic";

function defaultPeriod(): { startDate: string; endDate: string } {
  // Default to the previous calendar month.
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export default async function InvoiceValidationPage() {
  const entity = await getEntityConfig();
  const { startDate, endDate } = defaultPeriod();
  return (
    <div className="px-8 py-8 max-w-7xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">Data Preparation</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Invoice Validation</h1>
        <p className="mt-1 text-sm text-slate-600">
          Compare ConnectWise invoices to Business Central sales invoices for a date range.
          Invoices are matched on invoice number within each customer; amount mismatches and
          invoices missing from either side are highlighted.
        </p>
      </header>
      {entity.bcConfigured && entity.cwConfigured ? (
        <InvoiceValidationClient defaultStartDate={startDate} defaultEndDate={endDate} />
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Both Business Central and ConnectWise must be configured in{" "}
          <a className="underline" href="/settings">
            Settings
          </a>{" "}
          before running invoice validation.
        </div>
      )}
    </div>
  );
}
