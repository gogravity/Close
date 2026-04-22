import { NextResponse } from "next/server";
import {
  getInvoiceItems,
  buildInvoiceSummary,
  Pax8Error,
  type Pax8InvoiceItem,
  type InvoiceSummary,
} from "@/lib/pax8";

export const dynamic = "force-dynamic";

export type Pax8InvoiceDetailResponse = {
  ok: true;
  invoiceId: string;
  items: Pax8InvoiceItem[];
  summary: InvoiceSummary;
};

export type Pax8InvoiceDetailErrorResponse = {
  ok: false;
  error: string;
};

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { id } = params;
  if (!id) {
    return NextResponse.json<Pax8InvoiceDetailErrorResponse>(
      { ok: false, error: "Missing invoice id" },
      { status: 400 }
    );
  }

  try {
    const items   = await getInvoiceItems(id);
    const summary = buildInvoiceSummary(items);

    return NextResponse.json<Pax8InvoiceDetailResponse>({
      ok: true,
      invoiceId: id,
      items,
      summary,
    });
  } catch (err) {
    const msg =
      err instanceof Pax8Error
        ? `Pax8 ${err.status}: ${err.message}`
        : (err as Error).message;
    return NextResponse.json<Pax8InvoiceDetailErrorResponse>(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
