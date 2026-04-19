import { fmt } from "@/lib/recon";
import type { BcGlLedgerEntry } from "@/lib/businessCentral";

type Props = {
  view: "summary" | "activity";
  periodStart: string;
  periodEnd: string;
  bcAccountNumber: string;
  bcDisplayName: string;
  endingBalance: number;       // BC GL as of periodEnd
  openingBalance: number;      // BC GL as of day before periodStart
  entries: BcGlLedgerEntry[];  // all posted GL entries for this account during the period
};

export default function AltPaymentsPane({
  view,
  periodStart,
  periodEnd,
  bcAccountNumber,
  bcDisplayName,
  endingBalance,
  openingBalance,
  entries,
}: Props) {
  const activity = entries.reduce(
    (s, e) => s + (e.debitAmount - e.creditAmount),
    0
  );
  const computedEnding = openingBalance + activity;
  const variance = computedEnding - endingBalance;
  const rollsForward = Math.abs(variance) < 0.01;

  let runningBalance = openingBalance;

  return (
    <div className="space-y-6">
      {/* Summary strip — shared on both views */}
      <div className="rounded border border-slate-200 bg-white">
        <div className="grid grid-cols-4 divide-x divide-slate-200">
          <HeaderCell
            label="GL Account"
            value={`${bcAccountNumber} — ${bcDisplayName}`}
          />
          <HeaderCell label="Opening Balance" value={fmt(openingBalance)} emphasis />
          <HeaderCell label="Period Activity" value={fmt(activity)} emphasis />
          <HeaderCell label="Ending Balance (BC)" value={fmt(endingBalance)} emphasis />
        </div>
      </div>

      {rollsForward ? (
        <div className="rounded border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm text-emerald-900">
          ✓ Roll-forward ties: Opening {fmt(openingBalance)} + Activity {fmt(activity)} = Ending{" "}
          {fmt(endingBalance)}. No adjusting JE required from this rec.
        </div>
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50/40 px-4 py-3 text-sm text-amber-900">
          Computed ending ({fmt(computedEnding)}) doesn&apos;t match BC GL ({fmt(endingBalance)}).
          Variance {fmt(variance)} — investigate.
        </div>
      )}

      {view === "summary" && (
        <div className="rounded border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-600">
          Drill into the <strong>Alt Pmt BC Activity</strong> tab above for the full
          transaction list driving this rec ({entries.length} entries).
        </div>
      )}

      {view === "activity" && (
        <>
      {/* Transaction detail — the "Alt Pmt BC Activity" tab, pulled live */}
      <div className="rounded border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <div className="text-sm font-semibold text-slate-900">
            Transaction activity ({periodStart} to {periodEnd})
          </div>
          <div className="text-xs text-slate-500">
            {entries.length} entr{entries.length === 1 ? "y" : "ies"} from BC GL
          </div>
        </div>
        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-[100px]">Date</th>
                <th className="px-3 py-2 text-left font-medium w-[100px]">Doc #</th>
                <th className="px-3 py-2 text-left font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium w-[120px]">Amount</th>
                <th className="px-3 py-2 text-right font-medium w-[120px]">Running</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-200 bg-slate-50 font-medium">
                <td className="px-3 py-1.5 text-slate-500" colSpan={3}>
                  Opening balance
                </td>
                <td className="px-3 py-1.5"></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(openingBalance)}</td>
              </tr>
              {entries.map((e) => {
                const amount = e.debitAmount - e.creditAmount;
                runningBalance += amount;
                const date = e.postingDate?.slice(0, 10) ?? "";
                // Flag transactions near period end: they may be posted in BC
                // but not yet settled by the processor.
                const daysBeforeEnd = Math.floor(
                  (new Date(periodEnd).getTime() - new Date(date).getTime()) /
                    (24 * 60 * 60 * 1000)
                );
                const mightBePending = !Number.isNaN(daysBeforeEnd) && daysBeforeEnd <= 2;
                // Transaction-ID-style descriptions (UUID or INVOICE_PAYMENT: prefix)
                // from the processor are an even stronger signal of pending status.
                const hasRawTxnId =
                  /INVOICE_PAYMENT:|\b[0-9a-f]{8}-[0-9a-f]{4}/i.test(e.description ?? "");
                const pending = mightBePending && hasRawTxnId;
                return (
                  <tr
                    key={e.entryNumber}
                    className={`border-t border-slate-100 ${pending ? "bg-amber-50/60" : ""}`}
                    title={
                      pending
                        ? "Near period-end with raw processor transaction ID — likely posted to BC but not yet settled by Alternative Payments. Investigate timing."
                        : undefined
                    }
                  >
                    <td className="px-3 py-1 font-mono text-[11px] text-slate-500">
                      {date}
                    </td>
                    <td className="px-3 py-1 font-mono text-[11px] text-slate-500">
                      {e.documentNumber}
                    </td>
                    <td className="px-3 py-1 truncate max-w-[380px]" title={e.description}>
                      {pending && (
                        <span className="mr-1 text-amber-600" title="likely pending settlement">
                          ⚠
                        </span>
                      )}
                      {e.description}
                    </td>
                    <td
                      className={`px-3 py-1 text-right tabular-nums ${
                        amount < 0 ? "text-slate-500" : ""
                      }`}
                    >
                      {fmt(amount)}
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums">
                      {fmt(runningBalance)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                <td className="px-3 py-1.5" colSpan={3}>
                  Ending balance (computed)
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(activity)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(computedEnding)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded border border-dashed border-slate-300 px-4 py-3 text-xs text-slate-500">
        Data source: BC <code>generalLedgerEntries</code> filtered to account{" "}
        {bcAccountNumber}, posting date {periodStart} through {periodEnd}. No manual input —
        this is the same data as the master workbook&apos;s <em>Alt Pmt BC Activity</em> tab.
      </div>
        </>
      )}
    </div>
  );
}

function HeaderCell({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 ${emphasis ? "text-lg font-semibold tabular-nums" : "text-sm"} text-slate-900`}>
        {value}
      </div>
    </div>
  );
}
