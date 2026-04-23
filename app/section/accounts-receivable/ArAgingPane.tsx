import { fmt } from "@/lib/recon";

type Customer = {
  customerNumber: string;
  name: string;
  balanceDue: number;
  current: number;
  d1to60: number;
  d61to90: number;
  d91to180: number;
  d181to360: number;
  over360: number;
};

type Totals = {
  balanceDue: number;
  current: number;
  d1to60: number;
  d61to90: number;
  d91to180: number;
  d181to360: number;
  over360: number;
};

type Props = {
  asOfDate: string;
  totals: Totals;
  customers: Customer[];
};

const BUCKET_ROWS = [
  { key: "current", label: "Current" },
  { key: "d1to60", label: "1 - 60 days" },
  { key: "d61to90", label: "61 - 90 days" },
  { key: "d91to180", label: "91 - 180 days" },
  { key: "d181to360", label: "181 - 360 days" },
  { key: "over360", label: "Over 360 days" },
] as const;

export default function ArAgingPane({ asOfDate, totals, customers }: Props) {
  return (
    <div className="space-y-6">
      <div className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
          Accounts Receivable Aging Summary — as of {asOfDate}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left font-medium w-[140px]">Bucket</th>
              <th className="px-4 py-2 text-right font-medium">Total amount</th>
              <th className="px-4 py-2 text-right font-medium">% of AR</th>
            </tr>
          </thead>
          <tbody>
            {BUCKET_ROWS.map((r) => {
              const amt = totals[r.key];
              const pct = totals.balanceDue ? amt / totals.balanceDue : 0;
              return (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="px-4 py-1.5">{r.label}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{fmt(amt)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">
                    {(pct * 100).toFixed(2)}%
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
              <td className="px-4 py-1.5">AR balance</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(totals.balanceDue)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">100.00%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <div className="text-sm font-semibold text-slate-900">
            Customer aging detail
          </div>
          <div className="text-xs text-slate-500">
            {customers.length} customer{customers.length === 1 ? "" : "s"} with open balance
          </div>
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-[90px]">Customer</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Current</th>
                <th className="px-3 py-2 text-right font-medium">1-60</th>
                <th className="px-3 py-2 text-right font-medium">61-90</th>
                <th className="px-3 py-2 text-right font-medium">91-180</th>
                <th className="px-3 py-2 text-right font-medium">181-360</th>
                <th className="px-3 py-2 text-right font-medium">&gt;360</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.customerNumber} className="border-t border-slate-100">
                  <td className="px-3 py-1 font-mono text-[11px] text-slate-500">
                    {c.customerNumber}
                  </td>
                  <td className="px-3 py-1 truncate max-w-[260px]" title={c.name}>
                    {c.name}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {c.current === 0 ? "" : fmt(c.current)}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {c.d1to60 === 0 ? "" : fmt(c.d1to60)}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {c.d61to90 === 0 ? "" : fmt(c.d61to90)}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {c.d91to180 === 0 ? "" : fmt(c.d91to180)}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {c.d181to360 === 0 ? "" : fmt(c.d181to360)}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {c.over360 === 0 ? "" : fmt(c.over360)}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums font-medium">
                    {fmt(c.balanceDue)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                <td colSpan={2} className="px-3 py-1.5">
                  Totals
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totals.current)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totals.d1to60)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totals.d61to90)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totals.d91to180)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totals.d181to360)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totals.over360)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(totals.balanceDue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
