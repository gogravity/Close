import { fmt } from "@/lib/recon";

type Vendor = {
  vendorNumber: string;
  name: string;
  balanceDue: number;
  currentAmount: number;
  period1Amount: number;
  period2Amount: number;
  period3Amount: number;
};

type Props = {
  asOfDate: string;
  periodLengthFilter: string;
  totals: {
    balanceDue: number;
    current: number;
    period1: number;
    period2: number;
    period3: number;
  };
  vendors: Vendor[];
};

export default function ApAgingPane({
  asOfDate,
  periodLengthFilter,
  totals,
  vendors,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
          Accounts Payable Aging Summary — as of {asOfDate} ({periodLengthFilter} buckets)
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left font-medium w-[90px]">Bucket</th>
              <th className="px-4 py-2 text-right font-medium">Total amount</th>
              <th className="px-4 py-2 text-right font-medium">% of AP</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                { key: "Current", amt: totals.current },
                { key: "31 - 60 days", amt: totals.period1 },
                { key: "61 - 90 days", amt: totals.period2 },
                { key: "Over 90 days", amt: totals.period3 },
              ] as const
            ).map((r) => {
              const pct = totals.balanceDue ? r.amt / totals.balanceDue : 0;
              return (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="px-4 py-1.5">{r.key}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{fmt(r.amt)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">
                    {(pct * 100).toFixed(2)}%
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
              <td className="px-4 py-1.5">AP balance</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(totals.balanceDue)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">100.00%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <div className="text-sm font-semibold text-slate-900">Vendor aging detail</div>
          <div className="text-xs text-slate-500">
            {vendors.length} vendor{vendors.length === 1 ? "" : "s"} with open balance
          </div>
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-[90px]">Vendor</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Current</th>
                <th className="px-3 py-2 text-right font-medium">31-60</th>
                <th className="px-3 py-2 text-right font-medium">61-90</th>
                <th className="px-3 py-2 text-right font-medium">91+</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.vendorNumber} className="border-t border-slate-100">
                  <td className="px-3 py-1 font-mono text-[11px] text-slate-500">
                    {v.vendorNumber}
                  </td>
                  <td className="px-3 py-1 truncate max-w-[260px]" title={v.name}>
                    {v.name}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {v.currentAmount === 0 ? "" : fmt(v.currentAmount)}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {v.period1Amount === 0 ? "" : fmt(v.period1Amount)}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {v.period2Amount === 0 ? "" : fmt(v.period2Amount)}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {v.period3Amount === 0 ? "" : fmt(v.period3Amount)}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums font-medium">
                    {fmt(v.balanceDue)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                <td colSpan={2} className="px-3 py-1.5">
                  Totals
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totals.current)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totals.period1)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totals.period2)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totals.period3)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totals.balanceDue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
