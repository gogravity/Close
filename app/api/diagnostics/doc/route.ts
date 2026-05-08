import { NextResponse } from "next/server";
import { listGlEntriesRange } from "@/lib/businessCentral";

export const dynamic = "force-dynamic";

/** Pull all GL lines for a specific document number. ?doc=PAY%20NOV%201%20-%20NOV%2015 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const doc = url.searchParams.get("doc");
    if (!doc) return NextResponse.json({ ok: false, error: "?doc=... required" }, { status: 400 });

    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - 12);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const entries = await listGlEntriesRange(fmt(start), fmt(end));
    const lines = entries.filter((e) => e.documentNumber === doc);

    let dr = 0, cr = 0;
    for (const l of lines) { dr += l.debitAmount; cr += l.creditAmount; }

    return NextResponse.json({
      ok: true,
      doc,
      lineCount: lines.length,
      debitTotal:  Math.round(dr * 100) / 100,
      creditTotal: Math.round(cr * 100) / 100,
      diff: Math.round((dr - cr) * 100) / 100,
      lines: lines
        .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
        .map((l) => ({
          account:     l.accountNumber,
          description: l.description ?? "",
          debit:       l.debitAmount,
          credit:      l.creditAmount,
        })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
