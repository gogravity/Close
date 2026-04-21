import { NextResponse } from "next/server";
import {
  ConnectWiseError,
  applyPaymentToCwInvoice,
  getCwInvoicePayments,
  listAllOpenCwInvoices,
} from "@/lib/connectwise";
import { listOpenCustomerLedgerEntries } from "@/lib/businessCentral";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const invoiceId = searchParams.get("invoiceId");
  if (!invoiceId || isNaN(Number(invoiceId))) {
    return NextResponse.json({ ok: false, error: "invoiceId query param required" }, { status: 400 });
  }
  try {
    const payments = await getCwInvoicePayments(Number(invoiceId));
    return NextResponse.json({ ok: true, payments });
  } catch (err) {
    const msg = err instanceof ConnectWiseError
      ? `CW ${err.status}: ${err.message}`
      : (err as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  // action: "apply-payment"
  // Body: { action: "apply-payment", invoices: [{ id, balance, dueDate }] }
  // Posts a payment for each invoice on its due date (falls back to invoice date).
  if (b.action === "apply-payment") {
    const invoices = b.invoices;
    if (!Array.isArray(invoices) || invoices.length === 0) {
      return NextResponse.json(
        { ok: false, error: "invoices must be a non-empty array of {id, balance, dueDate}" },
        { status: 400 }
      );
    }

    const results: { id: number; ok: boolean; error?: string }[] = [];

    for (const inv of invoices) {
      const { id, balance, dueDate } = inv as { id: number; balance: number; dueDate: string };
      if (typeof id !== "number" || typeof balance !== "number") {
        results.push({ id: id as number, ok: false, error: "Invalid invoice payload" });
        continue;
      }
      // Use dueDate if available, otherwise fall back to today
      const paymentDate = dueDate
        ? dueDate.slice(0, 10) + "T00:00:00Z"
        : new Date().toISOString().slice(0, 10) + "T00:00:00Z";
      try {
        await applyPaymentToCwInvoice(id, balance, paymentDate);
        results.push({ id, ok: true });
      } catch (err) {
        const msg = err instanceof ConnectWiseError
          ? `CW ${err.status}: ${err.message}`
          : (err as Error).message;
        results.push({ id, ok: false, error: msg });
      }
    }

    const allOk = results.every((r) => r.ok);
    return NextResponse.json({ ok: allOk, results });
  }

  // action: "apply-payment-all-stale"
  // Server-side: fetch all stale invoices, apply payments to zero out balances.
  if (b.action === "apply-payment-all-stale") {
    const [cwRaw, bcRaw] = await Promise.all([
      listAllOpenCwInvoices(),
      listOpenCustomerLedgerEntries(),
    ]);

    const bcKeys = new Set<string>();
    for (const bc of bcRaw) {
      if (bc.externalDocumentNumber) bcKeys.add(bc.externalDocumentNumber.toUpperCase());
      if (bc.documentNumber) bcKeys.add(bc.documentNumber.toUpperCase());
    }

    const stale = cwRaw.filter(
      (inv) => (inv.balance ?? 0) > 0.005 && !bcKeys.has(inv.invoiceNumber.toUpperCase())
    );

    const results: { id: number; invoiceNumber: string; companyName: string; balance: number; ok: boolean; error?: string }[] = [];

    for (const inv of stale) {
      const balance = inv.balance ?? 0;
      const paymentDate = (inv.dueDate ?? inv.date ?? new Date().toISOString()).slice(0, 10) + "T00:00:00Z";
      try {
        await applyPaymentToCwInvoice(inv.id, balance, paymentDate);
        results.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, companyName: inv.company?.name ?? "", balance, ok: true });
      } catch (err) {
        const msg = err instanceof ConnectWiseError
          ? `CW ${err.status}: ${err.message}`
          : (err as Error).message;
        results.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, companyName: inv.company?.name ?? "", balance, ok: false, error: msg });
      }
    }

    const applied = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    const totalBalance = stale.reduce((s, inv) => s + (inv.balance ?? 0), 0);
    return NextResponse.json({ ok: failed === 0, applied, failed, totalBalance, results });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${b.action}` }, { status: 400 });
}
