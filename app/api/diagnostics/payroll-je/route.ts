import { NextResponse } from "next/server";
import { listGlEntriesRange } from "@/lib/businessCentral";

export const dynamic = "force-dynamic";

const PAYROLL_ACCOUNTS = [
  // Debits
  "500010", "500040", "503000", "505010", "502040",
  "600010", "600040", "600080", "600090", "600100",
  // Credits
  "202010", "202040", "202050", "202070", "202080",
];

/** Pull all GL entries on payroll accounts in the last 3 months, group by
 *  documentNumber, and return only docs that look like payroll (have a CR
 *  to 202010 Accrued Wages). Helps verify our generated JE structure
 *  matches what's historically been posted. */
export async function GET() {
  try {
    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - 3);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const entries = await listGlEntriesRange(fmt(start), fmt(end), PAYROLL_ACCOUNTS);

    type Line = { account: string; description: string; debit: number; credit: number };
    type Doc = { doc: string; date: string; lines: Line[]; debitTotal: number; creditTotal: number; byAccount: Record<string, { dr: number; cr: number }> };

    const byDoc = new Map<string, Doc>();
    for (const e of entries) {
      const k = e.documentNumber ?? "(no doc)";
      if (!byDoc.has(k)) {
        byDoc.set(k, { doc: k, date: e.postingDate, lines: [], debitTotal: 0, creditTotal: 0, byAccount: {} });
      }
      const d = byDoc.get(k)!;
      d.lines.push({
        account:     e.accountNumber,
        description: e.description ?? "",
        debit:       e.debitAmount,
        credit:      e.creditAmount,
      });
      d.debitTotal  += e.debitAmount;
      d.creditTotal += e.creditAmount;
      const a = d.byAccount[e.accountNumber] ?? { dr: 0, cr: 0 };
      a.dr += e.debitAmount;
      a.cr += e.creditAmount;
      d.byAccount[e.accountNumber] = a;
    }

    const payrollDocs = [...byDoc.values()]
      .filter((d) => d.lines.some((l) => l.account === "202010" && l.credit > 0))
      .sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json({
      ok: true,
      totalDocs: payrollDocs.length,
      docs: payrollDocs.slice(0, 5).map((d) => ({
        doc:         d.doc,
        date:        d.date,
        debitTotal:  Math.round(d.debitTotal * 100) / 100,
        creditTotal: Math.round(d.creditTotal * 100) / 100,
        diff:        Math.round((d.debitTotal - d.creditTotal) * 100) / 100,
        byAccount:   Object.fromEntries(
          Object.entries(d.byAccount).map(([a, v]) => [a, {
            dr:  Math.round(v.dr * 100) / 100,
            cr:  Math.round(v.cr * 100) / 100,
            net: Math.round((v.dr - v.cr) * 100) / 100,
          }])
        ),
        lines: d.lines.sort((a, b) => a.account.localeCompare(b.account)),
      })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
