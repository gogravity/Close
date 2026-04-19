import Link from "next/link";
import { redirect } from "next/navigation";
import { findSection, fmt } from "@/lib/recon";
import { getEntityConfig, getAccountMappings } from "@/lib/settings";
import {
  listAccounts,
  getAccountBalances,
  BusinessCentralError,
} from "@/lib/businessCentral";
import { listStatements, toDollars, RampError } from "@/lib/ramp";

export const dynamic = "force-dynamic";

export default async function CreditCardsSectionPage() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");
  const section = findSection("credit-cards")!;

  try {
    const [accounts, balances, mappings, statements] = await Promise.all([
      listAccounts(),
      getAccountBalances(entity.periodEnd),
      getAccountMappings(),
      listStatements(12).catch((err) => {
        if (err instanceof RampError) return [] as Awaited<ReturnType<typeof listStatements>>;
        throw err;
      }),
    ]);

    const ccAccountNumbers = Object.entries(mappings)
      .filter(([, slug]) => slug === "credit-cards")
      .map(([num]) => num);
    const ccAccounts = accounts.filter((a) => ccAccountNumbers.includes(a.number));

    // Find the statement whose billing period ends on the same day as our
    // close period. Fall back to the most recent statement ending on or
    // before the close period.
    const periodEndTs = new Date(entity.periodEnd).getTime();
    const closestStatement = statements
      .map((s) => ({ s, endTs: new Date(s.end_date).getTime() }))
      .filter((x) => !Number.isNaN(x.endTs) && x.endTs <= periodEndTs + 24 * 3600 * 1000)
      .sort((a, b) => b.endTs - a.endTs)[0]?.s;

    const rampEndingBalance = closestStatement
      ? toDollars(closestStatement.ending_balance)
      : 0;
    const rampCharges = closestStatement ? toDollars(closestStatement.charges) : 0;
    const rampPayments = closestStatement ? toDollars(closestStatement.payments) : 0;

    // BC balance for the mapped card accounts at period-end.
    const ccGlBalance = ccAccounts.reduce(
      (s, a) => s + (balances.get(a.number) ?? 0),
      0
    );
    // Card payables are negative in GL (liability). Flip to positive for compare.
    const glPayable = -ccGlBalance;
    const variance = glPayable - rampEndingBalance;
    const material = Math.abs(variance) >= 0.01;

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
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">{section.title}</h1>
            <p className="mt-1 text-sm text-slate-600">
              Ramp statement ending balance vs Business Central GL at period end.
            </p>
          </div>
          <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            Live · Ramp + BC
          </span>
        </header>

        {!closestStatement ? (
          <div className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
            No Ramp statement found on or before {entity.periodEnd}.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary strip */}
            <div className="grid grid-cols-4 gap-3">
              <Panel label="Opening balance" value={fmt(toDollars(closestStatement.opening_balance))} tone="neutral" />
              <Panel label="Charges" value={fmt(rampCharges)} tone="neutral" />
              <Panel label="Payments" value={fmt(-rampPayments)} tone="neutral" />
              <Panel label="Ending balance (Ramp)" value={fmt(rampEndingBalance)} tone="neutral" emphasis />
            </div>

            {/* Recon block */}
            <div className="rounded border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">
                  Account Reconciliation
                </div>
                <div className="text-xs text-slate-500">
                  Statement {closestStatement.start_date.slice(0, 10)} → {closestStatement.end_date.slice(0, 10)}
                  {closestStatement.statement_url && (
                    <>
                      {" · "}
                      <a
                        href={closestStatement.statement_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        📄 View statement PDF
                      </a>
                    </>
                  )}
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                <Row label="Ramp statement ending balance" value={rampEndingBalance} />
                <Row label="BC GL balance (card payables, period-end)" value={glPayable} />
                <Row
                  label="Variance (GL − Ramp)"
                  value={variance}
                  tone={material ? "warn" : "ok"}
                  emphasis
                />
              </div>
            </div>

            {/* GL accounts breakdown */}
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Mapped GL accounts ({ccAccounts.length})
              </h2>
              <div className="overflow-hidden rounded border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium w-[90px]">BC #</th>
                      <th className="px-3 py-2 text-left font-medium">Account</th>
                      <th className="px-3 py-2 text-right font-medium">GL balance at {entity.periodEnd}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ccAccounts.map((a) => (
                      <tr key={a.number} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">{a.number}</td>
                        <td className="px-3 py-1.5">{a.displayName}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {fmt(balances.get(a.number) ?? 0)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                      <td colSpan={2} className="px-3 py-1.5">
                        Section total
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(ccGlBalance)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* JE */}
            {material ? (
              <div className="rounded border border-amber-200 bg-amber-50/40">
                <div className="border-b border-amber-200 px-4 py-2 text-sm font-semibold text-amber-900">
                  Adjusting Journal Entry
                </div>
                <div className="px-4 py-3 space-y-2 text-sm">
                  <div className="text-xs text-amber-800">
                    {variance > 0
                      ? `GL payable is higher than Ramp's statement by ${fmt(Math.abs(variance))} — write down.`
                      : `GL payable is lower than Ramp's statement by ${fmt(Math.abs(variance))} — book additional charge.`}
                  </div>
                  <table className="mt-2 w-full text-sm">
                    <thead className="text-slate-600">
                      <tr>
                        <th className="py-1 text-left font-medium w-[80px]">BC #</th>
                        <th className="py-1 text-left font-medium">Account</th>
                        <th className="py-1 text-right font-medium w-[130px]">Debit</th>
                        <th className="py-1 text-right font-medium w-[130px]">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="border-t border-amber-200">
                      {variance > 0 ? (
                        <>
                          <tr>
                            <td className="py-1 font-mono text-[11px] text-slate-500">
                              {ccAccounts[0]?.number ?? "—"}
                            </td>
                            <td className="py-1">{ccAccounts[0]?.displayName ?? "Credit Card Payable"}</td>
                            <td className="py-1 text-right tabular-nums">{fmt(Math.abs(variance))}</td>
                            <td className="py-1 text-right">—</td>
                          </tr>
                          <tr>
                            <td className="py-1 font-mono text-[11px] text-slate-500">—</td>
                            <td className="py-1 italic text-slate-500">
                              Miscellaneous Expense (unassigned)
                            </td>
                            <td className="py-1 text-right">—</td>
                            <td className="py-1 text-right tabular-nums">{fmt(Math.abs(variance))}</td>
                          </tr>
                        </>
                      ) : (
                        <>
                          <tr>
                            <td className="py-1 font-mono text-[11px] text-slate-500">—</td>
                            <td className="py-1 italic text-slate-500">
                              Miscellaneous Expense (unassigned)
                            </td>
                            <td className="py-1 text-right tabular-nums">{fmt(Math.abs(variance))}</td>
                            <td className="py-1 text-right">—</td>
                          </tr>
                          <tr>
                            <td className="py-1 font-mono text-[11px] text-slate-500">
                              {ccAccounts[0]?.number ?? "—"}
                            </td>
                            <td className="py-1">{ccAccounts[0]?.displayName ?? "Credit Card Payable"}</td>
                            <td className="py-1 text-right">—</td>
                            <td className="py-1 text-right tabular-nums">{fmt(Math.abs(variance))}</td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="rounded border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm text-emerald-900">
                ✓ Ramp statement ties to BC GL. No adjusting JE required.
              </div>
            )}

            {/* Statement history */}
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Recent statements
              </h2>
              <div className="overflow-hidden rounded border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Period</th>
                      <th className="px-3 py-2 text-right font-medium">Opening</th>
                      <th className="px-3 py-2 text-right font-medium">Charges</th>
                      <th className="px-3 py-2 text-right font-medium">Payments</th>
                      <th className="px-3 py-2 text-right font-medium">Ending</th>
                      <th className="px-3 py-2 text-left font-medium">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statements.map((s) => {
                      const isActive = s.id === closestStatement.id;
                      return (
                        <tr
                          key={s.id}
                          className={`border-t border-slate-100 ${
                            isActive ? "bg-emerald-50/40" : ""
                          }`}
                        >
                          <td className="px-3 py-1.5 font-mono text-[11px] text-slate-600">
                            {s.start_date.slice(0, 10)} → {s.end_date.slice(0, 10)}
                            {isActive && (
                              <span className="ml-1 rounded bg-emerald-100 px-1 text-[9px] font-semibold uppercase text-emerald-800">
                                active
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {fmt(toDollars(s.opening_balance))}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {fmt(toDollars(s.charges))}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {fmt(-toDollars(s.payments))}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                            {fmt(toDollars(s.ending_balance))}
                          </td>
                          <td className="px-3 py-1.5">
                            {s.statement_url ? (
                              <a
                                href={s.statement_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-blue-600 hover:underline"
                              >
                                📄 Open
                              </a>
                            ) : (
                              <span className="text-[10px] text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
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
  emphasis,
}: {
  label: string;
  value: string;
  tone: "neutral" | "ok" | "warn";
  emphasis?: boolean;
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
      ? "text-amber-700"
      : "text-slate-900";
  return (
    <div
      className={`rounded border px-4 py-3 ${
        emphasis ? "border-slate-400 bg-slate-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
  tone = "neutral",
}: {
  label: string;
  value: number;
  emphasis?: boolean;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-slate-900";
  return (
    <div
      className={`flex items-center justify-between px-4 py-2 ${
        emphasis ? "bg-slate-50 font-semibold" : ""
      }`}
    >
      <div className="text-sm text-slate-700">{label}</div>
      <span className={`tabular-nums text-sm ${toneClass}`}>{fmt(value)}</span>
    </div>
  );
}
