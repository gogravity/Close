import { NextResponse } from "next/server";
import {
  listInvoices,
  listActiveSubscriptions,
  buildEstimatedBill,
  Pax8Error,
  type Pax8Invoice,
  type EstimatedBill,
} from "@/lib/pax8";

export const dynamic = "force-dynamic";

export type Pax8InvoicesResponse = {
  ok: true;
  invoices: Pax8Invoice[];
  estimated: EstimatedBill;
};

export type Pax8InvoicesErrorResponse = {
  ok: false;
  error: string;
};

export async function GET(): Promise<NextResponse> {
  try {
    const [invoices, subs] = await Promise.all([
      listInvoices(12),
      listActiveSubscriptions(),
    ]);
    const estimated = buildEstimatedBill(subs);

    return NextResponse.json<Pax8InvoicesResponse>({ ok: true, invoices, estimated });
  } catch (err) {
    const msg =
      err instanceof Pax8Error
        ? `Pax8 ${err.status}: ${err.message}`
        : (err as Error).message;
    return NextResponse.json<Pax8InvoicesErrorResponse>(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
