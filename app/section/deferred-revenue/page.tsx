import Link from "next/link";
import { redirect } from "next/navigation";
import { findSection, fmt } from "@/lib/recon";
import { getEntityConfig, getAccountMappings } from "@/lib/settings";
import {
  listAccounts,
  getAccountBalances,
  getAccountMonthlyActivity,
  BusinessCentralError,
} from "@/lib/businessCentral";

export const dynamic = "force-dynamic";

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function shiftMonths(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

export default async function DeferredRevenueSectionPage() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");
  const section = findSection("deferred-revenue")!;

  try {
    const [accounts, balances, mappings] = await Promise.all([
      listAccounts(),
      getAccountBalances(entity.periodEnd),
      getAccountMappings(),
    ]);

    const defRevNumbers = Object.entries(mappings)
      .filter(([, slug]) => slug === "deferred-revenue")
      .map(([num]) => num);
    const defRevAccounts = accounts.filter((a) => defRevNumbers.includes(a.number));
    const glBalance = defRevAccounts.reduce(
      (s, a) => s + (balances.get(a.number) ?? 0),
      0
    );

    // Recognition accounts — the income-side offsets. Match the Excel notes:
    // 403020 Re-occurring Block of Time Revenue, 404010 Re-occurring Resale
    // and Usage.
    const recognitionNumbers = ["403020", "404010"];
    const recognitionAccounts = accounts.filter((a) => recognitionNumbers.includes(a.number));

    // 12-month window ending at period-end.
    const windowStart = startOfMonth(shiftMonths(entity.periodEnd, -11));
    const primaryDefRev = defRevAccounts[0];

    const [defRevActivity, ...recActivities] = await Promise.all([
      primaryDefRev
        ? getAccountMonthlyActivity(primaryDefRev.number, windowStart, entity.periodEnd)
        : Promise.resolve([]),
      ...recognitionAccounts.map((a) =>
        getAccountMonthlyActivity(a.number, windowStart, entity.periodEnd)
      ),
    ]);

    // Opening balance = current GL − sum of period net activity.
    // GL is liability (negative). For rollforward we show positive deferred balance.
    const netActivityInWindow = defRevActivity.reduce((s, m) => s + m.net, 0);
    // Liability perspective: balance gets MORE negative when revenue is
    // deferred (credit). When recognized, GL debits bring it less negative.
    // Net activity in window (debit - credit) describes the GL movement;
    // the balance at start = current balance - activity.
    const currentGl = glBalance; // negative number
    const openingGl = currentGl - netActivityInWindow;

    // Monthly rollforward — build running balance from opening.
    const monthlyRows: {
      month: string;
      debit: number;
      credit: number;
      endingLiability: number;
    }[] = [];
    let running = openingGl;
    const byMonth = new Map(defRevActivity.map((m) => [m.month, m]));
    for (let i = 0; i < 12; i++) {
      const ym = shiftMonths(windowStart, i).slice(0, 7);
      const m = byMonth.get(ym);
      const d = m?.debit ?? 0;
      const c = m?.credit ?? 0;
      running = running + d - c;
      monthlyRows.push({
        month: ym,
        debit: d,
        credit: c,
        endingLiability: -running, // show as positive liability
      });
    }

    // Aggregate recognition activity by month (credit amounts → revenue
    // recognized that month).
    const recByMonth = new Map<string, number>();
    for (const arr of recActivities) {
      for (const m of arr) {
        recByMonth.set(m.month, (recByMonth.get(m.month) ?? 0) + m.credit);
      }
    }

    return (
      <div className="px-8 py-8 max-w-6xl">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
          ← Balance Sheet Summary
        </Link>
        <header className="mt-3 mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Section {section.order} · Period ending {entity.periodEnd}
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">
              Deferred Revenue — Annual &amp; Block Hours
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              12-month rollforward of {primaryDefRev?.number ?? "203010"}{" "}
              {primaryDefRev?.displayName ?? "Deferred Revenue"}, with recognition activity
              on {recognitionAccounts.map((a) => `${a.number}`).join(" / ")} by month.
            </p>
          </div>
          <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            Live · BC
          </span>
        </header>

        <div className="grid grid-cols-4 gap-3 mb-6">
          <Panel
            label="Opening balance (12 mo ago)"
            value={fmt(-openingGl)}
            tone="neutral"
          />
          <Panel
            label="Net billings − recognition"
            value={fmt(-netActivityInWindow)}
            tone="neutral"
          />
          <Panel
            label={`Ending balance @ ${entity.periodEnd}`}
            value={fmt(-currentGl)}
            tone="neutral"
          />
          <Panel
            label="Current period recognized"
            value={fmt(recByMonth.get(entity.periodEnd.slice(0, 7)) ?? 0)}
            tone="neutral"
          />
        </div>

        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Monthly Balance — {primaryDefRev?.number} {primaryDefRev?.displayName}
          </h2>
          <div className="overflow-hidden rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium w-[120px]">Month</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Recognized (Dr 203010)
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    New billings (Cr 203010)
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Net change</th>
                  <th className="px-3 py-2 text-right font-medium">Ending balance</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((r) => {
                  const isCurrent = r.month === entity.periodEnd.slice(0, 7);
                  return (
                    <tr
                      key={r.month}
                      className={`border-t border-slate-100 ${
                        isCurrent ? "bg-emerald-50/40" : ""
                      }`}
                    >
                      <td className="px-3 py-1.5">
                        {monthLabel(r.month)}
                        {isCurrent && (
                          <span className="ml-1 rounded bg-emerald-100 px-1 text-[9px] font-semibold uppercase text-emerald-800">
                            current
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.debit === 0 ? "—" : fmt(r.debit)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.credit === 0 ? "—" : fmt(r.credit)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                        {fmt(r.debit - r.credit)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                        {fmt(r.endingLiability)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Revenue recognition offset accounts
          </h2>
          <div className="overflow-hidden rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium w-[90px]">BC #</th>
                  <th className="px-3 py-2 text-left font-medium">Account</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Activity {windowStart.slice(0, 7)} → {entity.periodEnd.slice(0, 7)} (credits)
                  </th>
                </tr>
              </thead>
              <tbody>
                {recognitionAccounts.map((a, i) => {
                  const sum = recActivities[i]?.reduce((s, m) => s + m.credit, 0) ?? 0;
                  return (
                    <tr key={a.number} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">
                        {a.number}
                      </td>
                      <td className="px-3 py-1.5">{a.displayName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(sum)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="rounded border border-dashed border-slate-300 px-4 py-3 text-xs text-slate-500">
          <strong>Customer-level detail (pinned for later):</strong> the master workbook&apos;s{" "}
          <em>Annual &amp; Block Hours</em> tab breaks down the balance per customer per month
          (D&amp;A Truck Equipment, Bunnell, Relyant Global, etc.). BC&apos;s GL entries carry
          a <code>documentNumber</code> but no customer field directly — we&apos;ll need to
          join each entry&apos;s document number back to the originating sales invoice to
          populate the per-customer matrix.
        </div>
      </div>
    );
  } catch (err) {
    if (err instanceof BusinessCentralError) {
      return (
        <div className="px-8 py-10 max-w-3xl">
          <h1 className="text-xl font-semibold text-red-700">BC fetch failed</h1>
          <pre className="mt-3 rounded bg-slate-100 p-3 text-xs overflow-auto">
            {err.message}
            {err.body ? `\n\n${JSON.stringify(err.body, null, 2)}` : ""}
          </pre>
        </div>
      );
    }
    throw err;
  }
}

function Panel({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
      ? "text-amber-700"
      : "text-slate-900";
  return (
    <div className="rounded border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
