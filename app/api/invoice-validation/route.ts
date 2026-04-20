import { NextResponse } from "next/server";
import { BusinessCentralError } from "@/lib/businessCentral";
import { ConnectWiseError } from "@/lib/connectwise";
import { reconcileInvoices } from "@/lib/invoiceRecon";

export const dynamic = "force-dynamic";

function parseDate(val: unknown): string | null {
  if (typeof val !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) return null;
  const d = new Date(val.trim());
  if (isNaN(d.getTime())) return null;
  return val.trim();
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const startDate = parseDate(b?.startDate);
  const endDate = parseDate(b?.endDate);
  if (!startDate || !endDate) {
    return NextResponse.json(
      { ok: false, error: "startDate and endDate are required as YYYY-MM-DD strings" },
      { status: 400 }
    );
  }
  if (startDate > endDate) {
    return NextResponse.json(
      { ok: false, error: "startDate must be on or before endDate" },
      { status: 400 }
    );
  }
  try {
    const result = await reconcileInvoices(startDate, endDate);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof BusinessCentralError || err instanceof ConnectWiseError) {
      return NextResponse.json(
        { ok: false, error: err.message, status: err.status, body: err.body },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 200 }
    );
  }
}
