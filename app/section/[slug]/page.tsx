import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sections, fmt } from "@/lib/recon";
import { getEntityConfig } from "@/lib/settings";
import { loadSyncMeta } from "@/lib/balances";
import { computeSection, type Tier } from "@/lib/sections";
import { loadConfirmedJes } from "@/lib/confirmedJes";
import JeConfirmButton from "@/components/JeConfirmButton";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return sections.map((s) => ({ slug: s.slug }));
}

const TIER_META: Record<
  Tier,
  { label: string; className: string; blurb: string }
> = {
  live: {
    label: "Live",
    className: "bg-emerald-100 text-emerald-800 border-emerald-200",
    blurb: "Expected balance pulled live from the source system each time this page loads.",
  },
  "roll-forward": {
    label: "Roll-forward",
    className: "bg-amber-100 text-amber-800 border-amber-200",
    blurb:
      "Expected balance and journal entry are rolled forward from the prior period. Values and dates update automatically; logic stays identical until this section is wired to a live source.",
  },
  template: {
    label: "Template",
    className: "bg-slate-100 text-slate-700 border-slate-200",
    blurb:
      "No recurring adjustment in the template. Expected balance equals unadjusted unless a live source produces one.",
  },
};

export default async function SectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");

  const [data, syncMeta] = await Promise.all([
    computeSection(slug),
    loadSyncMeta(),
  ]);
  if (!data) notFound();

  const period = (syncMeta?.asOf ?? entity.periodEnd ?? "").slice(0, 7); // YYYY-MM
  const confirmedJes = await loadConfirmedJes(period);
  const confirmedJe = confirmedJes.get(slug) ?? null;

  const { section, tier, sourceLabel, unadjusted, expected, adjustment, accounts, journalEntry, rolledForwardFrom, notes } =
    data;
  const tierMeta = TIER_META[tier];
  const debitTotal = journalEntry?.lines.reduce((s, l) => s + l.debit, 0) ?? 0;
  const creditTotal = journalEntry?.lines.reduce((s, l) => s + l.credit, 0) ?? 0;

  return (
    <div className="px-8 py-8 max-w-5xl">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
        ← Balance Sheet Summary
      </Link>
      <header className="mt-3 mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Section {section.order} · Period ending {entity.periodEnd}
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{section.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{sourceLabel}</p>
        </div>
        <span
          className={`shrink-0 rounded border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${tierMeta.className}`}
          title={tierMeta.blurb}
        >
          {tierMeta.label}
        </span>
      </header>

      {/* Panel row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Panel label="Unadjusted (BC)" value={fmt(unadjusted)} tone="neutral" />
        <Panel label="Expected" value={fmt(expected)} tone="neutral" />
        <Panel
          label="Adjustment"
          value={fmt(adjustment)}
          tone={adjustment === 0 ? "ok" : "warn"}
        />
      </div>

      {/* Source BC accounts in this section */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Accounts in this section ({accounts.length})
        </h2>
        {accounts.length === 0 ? (
          <div className="rounded border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
            No BC accounts mapped to this section yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium w-[90px]">BC #</th>
                  <th className="px-3 py-2 text-left font-medium">Account</th>
                  <th className="px-3 py-2 text-right font-medium">Unadjusted Balance</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.number} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{a.number}</td>
                    <td className="px-3 py-1.5">{a.displayName}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {fmt(a.unadjustedBalance)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                  <td className="px-3 py-1.5" colSpan={2}>
                    Section total
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(unadjusted)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Journal entry */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Adjusting Journal Entry
          </h2>
          {rolledForwardFrom && (
            <span className="text-xs text-slate-500">
              Rolled forward from {rolledForwardFrom}
            </span>
          )}
        </div>
        {journalEntry ? (
          <>
            <div className="overflow-hidden rounded border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Memo</div>
                <div className="mt-0.5 text-slate-900">{journalEntry.memo}</div>
                {journalEntry.reverseFlag && (
                  <div className="mt-1 text-xs text-slate-500">
                    Reverse: {journalEntry.reverseFlag}
                  </div>
                )}
              </div>
              <table className="w-full text-sm">
                <thead className="bg-white text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Account</th>
                    <th className="px-3 py-2 text-right font-medium w-[130px]">Debit</th>
                    <th className="px-3 py-2 text-right font-medium w-[130px]">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {journalEntry.lines.map((l, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">{l.account}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {l.debit === 0 ? "" : fmt(l.debit)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {l.credit === 0 ? "" : fmt(l.credit)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                    <td className="px-3 py-1.5">Totals</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(debitTotal)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(creditTotal)}</td>
                  </tr>
                </tbody>
              </table>
              {Math.abs(debitTotal - creditTotal) >= 0.01 && (
                <div className="border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  JE does not balance — Dr ({fmt(debitTotal)}) ≠ Cr ({fmt(creditTotal)}). Review
                  the template entries for this section.
                </div>
              )}
            </div>

            {/* Confirm button — persists this JE to confirmed-jes.json and flows to dashboard */}
            <JeConfirmButton
              sectionSlug={slug}
              period={period}
              memo={journalEntry.memo}
              lines={journalEntry.lines}
              initialConfirmed={!!confirmedJe}
              confirmedAt={confirmedJe?.confirmedAt}
            />
          </>
        ) : (
          <div className="rounded border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
            No adjusting journal entry needed for this period. Expected balance equals
            unadjusted balance.
          </div>
        )}
        {notes.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-slate-500">
            {notes.map((n, i) => (
              <li key={i}>· {n}</li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-10 rounded border border-slate-200 bg-slate-50 px-4 py-4 text-sm">
        <div className="font-medium text-slate-900">Workbook tabs this section corresponds to</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {section.subtabs.map((t) => (
            <span
              key={t}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
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
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
