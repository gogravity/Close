import { NextResponse } from "next/server";
import { buildPayrollRapidStart, type RapidStartConfig } from "@/lib/payrollRapidStart";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: RapidStartConfig;
  try {
    body = (await req.json()) as RapidStartConfig;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.summaryRows) || body.summaryRows.length === 0) {
    return NextResponse.json({ ok: false, error: "summaryRows[] required" }, { status: 400 });
  }
  if (!body.postingDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.postingDate)) {
    return NextResponse.json({ ok: false, error: "postingDate (YYYY-MM-DD) required" }, { status: 400 });
  }
  if (!body.documentNo || typeof body.documentNo !== "string") {
    return NextResponse.json({ ok: false, error: "documentNo required" }, { status: 400 });
  }

  const buf = await buildPayrollRapidStart(body);
  const safeName = body.documentNo.replace(/[^a-zA-Z0-9-_]+/g, "_");
  return new NextResponse(new Uint8Array(buf) as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="payroll-${safeName}.rapidstart"`,
      "Cache-Control": "no-store",
    },
  });
}
