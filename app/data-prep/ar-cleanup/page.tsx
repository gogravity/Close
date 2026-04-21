import { getEntityConfig } from "@/lib/settings";
import {
  listAllOpenCwInvoices,
  ConnectWiseError,
} from "@/lib/connectwise";
import {
  listOpenCustomerLedgerEntries,
  BusinessCentralError,
} from "@/lib/businessCentral";
import ArCleanupClient, { type CwRow, type BcRow } from "./ArCleanupClient";

export const dynamic = "force-dynamic";

export default async function ArCleanupPage() {
  const entity = await getEntityConfig();

  if (!entity.bcConfigured || !entity.cwConfigured) {
    return (
      <div className="px-8 py-8 max-w-3xl">
        <header className="mb-6">
          <div className="text-xs uppercase tracking-wide text-slate-500">Data Preparation</div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">AR Cleanup</h1>
        </header>
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Both Business Central and ConnectWise must be configured in{" "}
          <a className="underline" href="/settings">
            Settings
          </a>{" "}
          before running AR cleanup.
        </div>
      </div>
    );
  }

  try {
    const [cwRaw, bcRaw] = await Promise.all([
      listAllOpenCwInvoices(),
      listOpenCustomerLedgerEntries(),
    ]);

    // CW: all invoices with balance > 0
    const cwRows: CwRow[] = cwRaw
      .filter((inv) => (inv.balance ?? 0) > 0.005)
      .map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        date: inv.date.slice(0, 10),
        dueDate: inv.dueDate?.slice(0, 10) ?? "",
        companyName: inv.company?.name ?? "",
        total: (inv.total ?? 0) + (inv.salesTax ?? 0),
        balance: inv.balance ?? 0,
        statusName: inv.status?.name ?? "",
      }));

    // BC: all open customer ledger entries
    const bcRows: BcRow[] = bcRaw.map((e) => ({
      id: e.id,
      documentType: e.documentType,
      documentNumber: e.documentNumber,
      externalDocumentNumber: e.externalDocumentNumber ?? "",
      postingDate: e.postingDate,
      dueDate: e.dueDate ?? "",
      customerName: e.customerName,
      description: e.description ?? "",
      remainingAmount: e.remainingAmount,
    }));

    return (
      <div className="px-8 py-8 max-w-7xl">
        <header className="mb-6">
          <div className="text-xs uppercase tracking-wide text-slate-500">Data Preparation</div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">AR Cleanup</h1>
          <p className="mt-1 text-sm text-slate-600">
            Compares all open invoices in ConnectWise (balance &gt; 0) against open entries in
            Business Central. Invoices open in CW but absent from BC are likely paid — close them
            in CW to reconcile. Matching uses CW invoice number ↔ BC external document number.
          </p>
        </header>

        <ArCleanupClient cwRows={cwRows} bcRows={bcRows} />
      </div>
    );
  } catch (err) {
    const isKnown = err instanceof BusinessCentralError || err instanceof ConnectWiseError;
    return (
      <div className="px-8 py-10 max-w-3xl">
        <h1 className="text-xl font-semibold text-red-700">Fetch failed</h1>
        <pre className="mt-3 rounded bg-slate-100 p-3 text-xs overflow-auto">
          {(err as Error).message}
          {isKnown && (err as BusinessCentralError).body
            ? `\n\n${JSON.stringify((err as BusinessCentralError).body, null, 2)}`
            : ""}
        </pre>
      </div>
    );
  }
}
