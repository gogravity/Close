import { NextResponse } from "next/server";
import { listGlEntriesRange } from "@/lib/businessCentral";

export const dynamic = "force-dynamic";

/** Search the entire GL for entries with "cell" or "phone" or "reimburs" in
 *  the description to find where cell phone reimbursement is booked in BC. */
export async function GET() {
  try {
    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - 6);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const entries = await listGlEntriesRange(fmt(start), fmt(end));

    const matches = entries
      .filter((e) => /cell|phone|reimburs/i.test(e.description ?? ""))
      .map((e) => ({
        date:        e.postingDate,
        doc:         e.documentNumber,
        account:     e.accountNumber,
        description: e.description,
        debit:       e.debitAmount,
        credit:      e.creditAmount,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const byAccount = new Map<string, { count: number; totalDr: number; totalCr: number }>();
    for (const m of matches) {
      const a = byAccount.get(m.account) ?? { count: 0, totalDr: 0, totalCr: 0 };
      a.count++;
      a.totalDr += m.debit;
      a.totalCr += m.credit;
      byAccount.set(m.account, a);
    }

    return NextResponse.json({
      ok: true,
      totalMatches: matches.length,
      byAccount: Object.fromEntries(
        [...byAccount.entries()].map(([acct, t]) => [acct, {
          count: t.count,
          totalDr: Math.round(t.totalDr * 100) / 100,
          totalCr: Math.round(t.totalCr * 100) / 100,
        }])
      ),
      sample: matches.slice(0, 30),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
