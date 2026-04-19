import Link from "next/link";
import { redirect } from "next/navigation";
import { findSection, fmt } from "@/lib/recon";
import { getEntityConfig } from "@/lib/settings";
import { findPrepaidCandidates } from "@/lib/prepaids";
import { BusinessCentralError } from "@/lib/businessCentral";
import { getDecisionsForPeriod } from "@/lib/prepaidDecisions";
import AccountPicker from "./AccountPicker";
import CandidateRow from "./CandidateRow";

export const dynamic = "force-dynamic";

export default async function PrepaidsSectionPage() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");
  const section = findSection("prepaids");
  if (!section) {
    return <div className="px-8 py-10">Section not configured.</div>;
  }

  try {
    const scan = await findPrepaidCandidates();
    const decisions = await getDecisionsForPeriod(scan.periodEnd);
    const totalCandidateAmount = scan.candidates.reduce(
      (s, c) => s + c.amount,
      0
    );
    const confirmedAmount = scan.candidates.reduce(
      (s, c) =>
        s + (decisions[String(c.entry.entryNumber)]?.confirmed ? c.amount : 0),
      0
    );
    const confirmedCount = scan.candidates.filter(
      (c) => decisions[String(c.entry.entryNumber)]?.confirmed
    ).length;
    const travelCount = scan.candidates.filter((c) => c.isTravel).length;
    const travelAmount = scan.candidates
      .filter((c) => c.isTravel)
      .reduce((s, c) => s + c.amount, 0);

    return (
      <div className="px-8 py-8 max-w-6xl">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
          ← Balance Sheet Summary
        </Link>
        <header className="mt-3 mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Section {section.order} · Period ending {scan.periodEnd}
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">{section.title}</h1>
            <p className="mt-1 text-sm text-slate-600">
              Scans BC expense postings in the current period and flags candidates that may
              belong on the balance sheet as prepaid assets. Recurring monthly vendors
              (seen in any of the prior {scan.lookbackMonths} months) are filtered out —
              <strong> except travel</strong>, which is always reviewed.
            </p>
          </div>
          <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            Live · BC
          </span>
        </header>

        <AccountPicker />

        <div className="mb-6 grid grid-cols-5 gap-3">
          <StatPill label="Candidates" value={String(scan.candidates.length)} tone="amber" />
          <StatPill label="Candidate total" value={fmt(totalCandidateAmount)} tone="neutral" />
          <StatPill
            label="Confirmed prepaid"
            value={`${confirmedCount} · ${fmt(confirmedAmount)}`}
            tone="neutral"
          />
          <StatPill
            label="Travel (≥ $200)"
            value={`${travelCount} · ${fmt(travelAmount)}`}
            tone="neutral"
          />
          <StatPill
            label="Skipped (recurring)"
            value={String(scan.skipped.recurring)}
            tone="slate"
          />
        </div>

        {scan.candidates.length === 0 ? (
          <div className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
            No prepaid candidates found for {scan.periodEnd.slice(0, 7)}.
            <br />
            Thresholds: travel ≥ {fmt(scan.travelThreshold)}, non-recurring ≥{" "}
            {fmt(scan.generalThreshold)}.
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium w-[90px]">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Vendor / Description</th>
                  <th className="px-3 py-2 text-left font-medium w-[180px]">Expense account</th>
                  <th className="px-3 py-2 text-right font-medium w-[100px]">Amount</th>
                  <th className="px-3 py-2 text-left font-medium w-[80px]">Why</th>
                  <th className="px-2 py-2 text-right font-medium w-[70px]"># Months</th>
                  <th className="px-2 py-2 text-left font-medium w-[130px]">Begin Date</th>
                  <th className="px-2 py-2 text-left font-medium w-[130px]">End Date</th>
                  <th className="px-3 py-2 text-left font-medium w-[110px]"></th>
                </tr>
              </thead>
              <tbody>
                {scan.candidates.map((c) => (
                  <CandidateRow
                    key={c.entry.entryNumber}
                    initialRecognition={
                      decisions[String(c.entry.entryNumber)]?.recognition
                    }
                    c={{
                      entryNumber: c.entry.entryNumber,
                      postingDate: c.entry.postingDate,
                      documentNumber: c.entry.documentNumber,
                      description: c.entry.description,
                      amount: c.amount,
                      isTravel: c.isTravel,
                      reason: c.reason,
                      accountNumber: c.account.number,
                      accountName: c.account.displayName,
                      isRecurring: c.isRecurring,
                      recurringMonthCount: c.recurringMonthCount,
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <PrepaidJournalEntries
          candidates={scan.candidates}
          decisions={decisions}
        />

        <div className="mt-6 rounded border border-dashed border-slate-300 px-4 py-3 text-xs text-slate-500">
          Scan rules:
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            <li>
              <strong>Travel accounts</strong> (account name contains travel / airline / hotel /
              lodging) → flag every charge ≥ {fmt(scan.travelThreshold)} regardless of recurrence.
              Next step: look up each in Ramp to find the travel date; if travel falls in a future
              period, reclass to <code>Prepaid Assets</code>.
            </li>
            <li>
              <strong>Other expense accounts</strong> → flag charges ≥{" "}
              {fmt(scan.generalThreshold)} only if the same vendor signature hasn&apos;t
              appeared in the {scan.lookbackMonths} prior months. Recurring monthly vendors are
              skipped — they&apos;re already on the right GL account.
            </li>
            <li>
              Vendor signature = first 3 tokens of the GL entry description (uppercased).
              Scanned {scan.skipped.totalExpenseEntriesInPeriod.toLocaleString()} expense entries
              in the current period; {scan.skipped.recurring} ruled out as recurring,{" "}
              {scan.skipped.belowThreshold} below thresholds.
            </li>
          </ul>
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

type ConfirmedItem = {
  entryNumber: number;
  description: string;
  amount: number;
  accountNumber: string;
  accountName: string;
  months: number;
  beginDate: string;
  endDate: string;
};

function PrepaidJournalEntries({
  candidates,
  decisions,
}: {
  candidates: Awaited<ReturnType<typeof findPrepaidCandidates>>["candidates"];
  decisions: Awaited<ReturnType<typeof getDecisionsForPeriod>>;
}) {
  const confirmed: ConfirmedItem[] = [];
  for (const c of candidates) {
    const d = decisions[String(c.entry.entryNumber)];
    if (!d?.confirmed || !d.recognition) continue;
    confirmed.push({
      entryNumber: c.entry.entryNumber,
      description: c.entry.description,
      amount: c.amount,
      accountNumber: c.account.number,
      accountName: c.account.displayName,
      months: d.recognition.months,
      beginDate: d.recognition.beginDate,
      endDate: d.recognition.endDate,
    });
  }

  if (confirmed.length === 0) return null;

  const singleMonth = confirmed.filter((c) => c.months === 1);
  const multiMonth = confirmed.filter((c) => c.months > 1);

  return (
    <div className="mt-8 space-y-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Adjusting Journal Entries
      </h2>
      {multiMonth.length > 0 && (
        <JeBlock
          title="Multi-month prepaids (amortize)"
          description="Reclass from expense to prepaid asset, then amortize evenly over the recognition window."
          items={multiMonth}
        />
      )}
      {singleMonth.length > 0 && (
        <JeBlock
          title="Single-month prepaids"
          description="Reclass from expense to prepaid at period-end; recognize in full when the service month hits."
          items={singleMonth}
        />
      )}
    </div>
  );
}

function JeBlock({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: ConfirmedItem[];
}) {
  const totalAmount = items.reduce((s, i) => s + i.amount, 0);
  // Aggregate credits by original expense account (one credit line per unique account).
  const byExpenseAcct = new Map<string, { name: string; amount: number }>();
  for (const i of items) {
    const key = i.accountNumber;
    const prev = byExpenseAcct.get(key);
    byExpenseAcct.set(key, {
      name: i.accountName,
      amount: (prev?.amount ?? 0) + i.amount,
    });
  }

  return (
    <div className="rounded border border-amber-200 bg-amber-50/40">
      <div className="border-b border-amber-200 px-4 py-2">
        <div className="text-sm font-semibold text-amber-900">{title}</div>
        <div className="mt-0.5 text-xs text-amber-800">{description}</div>
      </div>
      <div className="px-4 py-3">
        <table className="w-full text-sm">
          <thead className="text-slate-600">
            <tr>
              <th className="py-1 text-left font-medium w-[80px]">BC #</th>
              <th className="py-1 text-left font-medium">Account</th>
              <th className="py-1 text-right font-medium w-[130px]">Debit</th>
              <th className="py-1 text-right font-medium w-[130px]">Credit</th>
            </tr>
          </thead>
          <tbody className="border-t border-amber-200">
            <tr>
              <td className="py-1 font-mono text-[11px] text-slate-500">102050</td>
              <td className="py-1">Prepaid Assets</td>
              <td className="py-1 text-right tabular-nums">{fmt(totalAmount)}</td>
              <td className="py-1 text-right">—</td>
            </tr>
            {[...byExpenseAcct.entries()].map(([num, info]) => (
              <tr key={num}>
                <td className="py-1 font-mono text-[11px] text-slate-500">{num}</td>
                <td className="py-1">{info.name}</td>
                <td className="py-1 text-right">—</td>
                <td className="py-1 text-right tabular-nums">{fmt(info.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-amber-200 bg-white/60 font-semibold">
              <td className="py-1" colSpan={2}>
                Totals
              </td>
              <td className="py-1 text-right tabular-nums">{fmt(totalAmount)}</td>
              <td className="py-1 text-right tabular-nums">{fmt(totalAmount)}</td>
            </tr>
          </tbody>
        </table>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-600 hover:text-slate-900">
            Detail ({items.length} item{items.length === 1 ? "" : "s"})
          </summary>
          <table className="mt-2 w-full text-xs">
            <thead className="text-slate-600">
              <tr>
                <th className="py-1 text-left font-medium">Vendor / Description</th>
                <th className="py-1 text-left font-medium w-[180px]">Expense account</th>
                <th className="py-1 text-right font-medium w-[90px]">Months</th>
                <th className="py-1 text-left font-medium w-[110px]">Begin</th>
                <th className="py-1 text-left font-medium w-[110px]">End</th>
                <th className="py-1 text-right font-medium w-[110px]">Amount</th>
                <th className="py-1 text-right font-medium w-[110px]">Per month</th>
              </tr>
            </thead>
            <tbody className="border-t border-amber-200">
              {items.map((i) => (
                <tr key={i.entryNumber} className="border-t border-amber-100">
                  <td className="py-1 truncate max-w-[320px]" title={i.description}>
                    {i.description}
                  </td>
                  <td className="py-1 text-slate-600">
                    <span className="font-mono text-[10px] text-slate-500 mr-1">
                      {i.accountNumber}
                    </span>
                    {i.accountName}
                  </td>
                  <td className="py-1 text-right tabular-nums">{i.months}</td>
                  <td className="py-1 font-mono text-[10px] text-slate-600">
                    {i.beginDate}
                  </td>
                  <td className="py-1 font-mono text-[10px] text-slate-600">{i.endDate}</td>
                  <td className="py-1 text-right tabular-nums">{fmt(i.amount)}</td>
                  <td className="py-1 text-right tabular-nums">
                    {fmt(i.months > 0 ? i.amount / i.months : 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "amber" | "neutral" | "slate";
}) {
  const cls = {
    amber: "border-amber-200 text-amber-800",
    neutral: "border-slate-200 text-slate-900",
    slate: "border-slate-200 text-slate-700",
  }[tone];
  return (
    <div className={`rounded border bg-white px-4 py-3 ${cls}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
