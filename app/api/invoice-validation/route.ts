import { NextResponse } from "next/server";
import { BusinessCentralError } from "@/lib/businessCentral";
import { ConnectWiseError } from "@/lib/connectwise";
import { reconcileInvoices } from "@/lib/invoiceRecon";

export const dynamic = "force-dynamic";

function parseMonth(val: unknown): { year: number; month: number } | null {
  if (typeof val !== "string") return null;
  const m = /^(\d{4})-(\d{2})$/.exec(val.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const monthA = parseMonth((body as Record<string, unknown>)?.monthA);
  const monthB = parseMonth((body as Record<string, unknown>)?.monthB);
  if (!monthA || !monthB) {
    return NextResponse.json(
      { ok: false, error: "monthA and monthB are required as YYYY-MM strings" },
      { status: 400 }
    );
  }
  try {
    const result = await reconcileInvoices(monthA, monthB);
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
