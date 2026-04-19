import { fmt } from "@/lib/recon";

type Invoice = {
  id: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  vendorName: string;
  totalAmountIncludingTax: number;
  remainingAmount?: number;
  intercompanyCode: string;
  intercompanyName: string;
};

type Props = {
  invoices: Invoice[];
  apAccount: { number: string; displayName: string } | null;       // e.g. 200010
  intercompanyAccount: { number: string; displayName: string } | null; // e.g. 117950
};

export default function IntercompanyApPane({
  invoices,
  apAccount,
  intercompanyAccount,
}: Props) {
  const total = invoices.reduce(
    (s, i) => s + (i.remainingAmount ?? i.totalAmountIncludingTax),
    0
  );
  // Group by IC-<company> so the JE shows one credit line per counterparty.
  const byCounterparty = new Map<
    string,
    { code: string; name: string; amount: number; count: number }
  >();
  for (const inv of invoices) {
    const amt = inv.remainingAmount ?? inv.totalAmountIncludingTax;
    const prev = byCounterparty.get(inv.intercompanyCode);
    byCounterparty.set(inv.intercompanyCode, {
      code: inv.intercompanyCode,
      name: inv.intercompanyName,
      amount: (prev?.amount ?? 0) + amt,
      count: (prev?.count ?? 0) + 1,
    });
  }
  const counterparties = [...byCounterparty.values()].sort(
    (a, b) => b.amount - a.amount
  );

  if (invoices.length === 0) {
    return (
      <div className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
        No open AP invoices are tagged with an INTERCOMPANY dimension this period.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Panel
          label="Intercompany invoices"
          value={`${invoices.length} open`}
          tone="neutral"
        />
        <Panel label="Total to reclass" value={fmt(total)} tone="warn" />
        <Panel
          label="Counterparties"
          value={String(counterparties.length)}
          tone="neutral"
        />
      </div>

      {/* Open invoices list */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Open intercompany AP invoices
        </h2>
        <div className="overflow-hidden rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-[140px]">Invoice #</th>
                <th className="px-3 py-2 text-left font-medium w-[110px]">Date</th>
                <th className="px-3 py-2 text-left font-medium">Vendor</th>
                <th className="px-3 py-2 text-left font-medium">IC dimension</th>
                <th className="px-3 py-2 text-right font-medium w-[130px]">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-100">
                  <td className="px-3 py-1 font-mono text-[11px] text-slate-600">
                    {inv.number}
                  </td>
                  <td className="px-3 py-1 font-mono text-[11px] text-slate-500">
                    {inv.invoiceDate?.slice(0, 10)}
                  </td>
                  <td className="px-3 py-1">{inv.vendorName}</td>
                  <td className="px-3 py-1 text-xs text-slate-600">
                    <span className="font-mono text-[10px] text-slate-500 mr-1">
                      {inv.intercompanyCode}
                    </span>
                    {inv.intercompanyName}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {fmt(inv.remainingAmount ?? inv.totalAmountIncludingTax)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                <td colSpan={4} className="px-3 py-1.5">
                  Total to reclass
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Reclass JE */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Adjusting Journal Entry — Reclass to Intercompany
        </h2>
        <div className="rounded border border-amber-200 bg-amber-50/40">
          <div className="border-b border-amber-200 px-4 py-2 text-xs text-amber-800">
            Moves AP bills owed to Lyra-family companies off regular trade
            payables and onto the intercompany liability account, grouped by
            counterparty for audit.
          </div>
          <table className="w-full text-sm">
            <thead className="text-slate-600">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium w-[80px]">BC #</th>
                <th className="px-3 py-1.5 text-left font-medium">Account</th>
                <th className="px-3 py-1.5 text-left font-medium">Memo</th>
                <th className="px-3 py-1.5 text-right font-medium w-[130px]">Debit</th>
                <th className="px-3 py-1.5 text-right font-medium w-[130px]">Credit</th>
              </tr>
            </thead>
            <tbody className="border-t border-amber-200">
              <tr>
                <td className="px-3 py-1 font-mono text-[11px] text-slate-500">
                  {apAccount?.number ?? "—"}
                </td>
                <td className="px-3 py-1">
                  {apAccount?.displayName ?? (
                    <span className="italic text-slate-400">Accounts Payable (unassigned)</span>
                  )}
                </td>
                <td className="px-3 py-1 text-slate-600">
                  Reclass {invoices.length} intercompany invoices
                </td>
                <td className="px-3 py-1 text-right tabular-nums">{fmt(total)}</td>
                <td className="px-3 py-1 text-right">—</td>
              </tr>
              {counterparties.map((cp) => (
                <tr key={cp.code} className="border-t border-amber-100">
                  <td className="px-3 py-1 font-mono text-[11px] text-slate-500">
                    {intercompanyAccount?.number ?? "—"}
                  </td>
                  <td className="px-3 py-1">
                    {intercompanyAccount?.displayName ?? (
                      <span className="italic text-slate-400">
                        Intercompany Payable (unassigned)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1 text-xs text-slate-600">
                    Due to {cp.name}{" "}
                    <span className="font-mono text-[10px] text-slate-400">({cp.code})</span>
                    {cp.count > 1 ? ` · ${cp.count} invoices` : ""}
                  </td>
                  <td className="px-3 py-1 text-right">—</td>
                  <td className="px-3 py-1 text-right tabular-nums">{fmt(cp.amount)}</td>
                </tr>
              ))}
              <tr className="border-t border-amber-200 bg-white/60 font-semibold">
                <td className="px-3 py-1.5" colSpan={3}>
                  Totals
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(total)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
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
      <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
