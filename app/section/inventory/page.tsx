import Link from "next/link";
import { redirect } from "next/navigation";
import { findSection, fmt } from "@/lib/recon";
import { getEntityConfig, getAccountMappings } from "@/lib/settings";
import {
  listAccounts,
  getAccountBalances,
  listInventoryOnHand,
  BusinessCentralError,
} from "@/lib/businessCentral";

export const dynamic = "force-dynamic";

export default async function InventorySectionPage() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");

  const section = findSection("inventory")!;

  try {
    const [accounts, balances, mappings, items] = await Promise.all([
      listAccounts(),
      getAccountBalances(entity.periodEnd),
      getAccountMappings(),
      listInventoryOnHand(),
    ]);

    const invAccountNumbers = Object.entries(mappings)
      .filter(([, slug]) => slug === "inventory")
      .map(([num]) => num);
    const invAccounts = accounts.filter((a) => invAccountNumbers.includes(a.number));
    const glBalance = invAccounts.reduce(
      (s, a) => s + (balances.get(a.number) ?? 0),
      0
    );

    const computedValue = items.reduce(
      (s, it) => s + it.inventory * it.unitCost,
      0
    );
    const variance = glBalance - computedValue;
    const materialVariance = Math.abs(variance) >= 0.01;

    // Auto-detect COGS or Inventory Adjustment expense account for JE offset.
    const adjustmentAccount = accounts.find(
      (a) =>
        (a.category === "Expense" || a.category === "CostOfGoodsSold") &&
        /inventory\s*adjust|obsoles|shrinkage|cogs/i.test(a.displayName)
    );
    const primaryInventoryAccount =
      invAccounts.find((a) => /^inventory$/i.test(a.displayName)) ?? invAccounts[0];

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
              On-hand inventory valuation pulled live from Business Central{" "}
              <code className="text-[11px]">items</code>. Qty × Unit Cost vs GL.
            </p>
          </div>
          <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            Live · BC
          </span>
        </header>

        <div className="grid grid-cols-4 gap-3 mb-6">
          <Panel label="Items with stock" value={items.length.toLocaleString()} tone="neutral" />
          <Panel label="Computed value (Qty × Cost)" value={fmt(computedValue)} tone="neutral" />
          <Panel label="Inventory GL balance" value={fmt(glBalance)} tone="neutral" />
          <Panel
            label="Variance"
            value={fmt(variance)}
            tone={materialVariance ? "warn" : "ok"}
          />
        </div>

        {/* Mapped GL accounts */}
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Mapped GL accounts
          </h2>
          <div className="overflow-hidden rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium w-[80px]">BC #</th>
                  <th className="px-3 py-2 text-left font-medium">Account</th>
                  <th className="px-3 py-2 text-right font-medium">GL balance</th>
                </tr>
              </thead>
              <tbody>
                {invAccounts.map((a) => (
                  <tr key={a.number} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">
                      {a.number}
                    </td>
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
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(glBalance)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Item detail — mirrors the master workbook Inventory tab */}
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            On-hand inventory ({items.length} items)
          </h2>
          <div className="overflow-hidden rounded border border-slate-200 bg-white">
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium w-[80px]">No.</th>
                    <th className="px-3 py-2 text-left font-medium">Description</th>
                    <th className="px-3 py-2 text-left font-medium w-[70px]">UoM</th>
                    <th className="px-3 py-2 text-right font-medium w-[70px]">Qty</th>
                    <th className="px-3 py-2 text-right font-medium w-[110px]">Unit Cost</th>
                    <th className="px-3 py-2 text-right font-medium w-[120px]">Inventory Value</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const value = it.inventory * it.unitCost;
                    return (
                      <tr key={it.id} className="border-t border-slate-100">
                        <td className="px-3 py-1 font-mono text-[11px] text-slate-500">
                          {it.number}
                        </td>
                        <td className="px-3 py-1 truncate max-w-[380px]" title={it.displayName}>
                          {it.displayName}
                        </td>
                        <td className="px-3 py-1 text-slate-600">{it.baseUnitOfMeasureCode}</td>
                        <td className="px-3 py-1 text-right tabular-nums">
                          {it.inventory.toLocaleString()}
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums">
                          {it.unitCost.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 4,
                          })}
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums">{fmt(value)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                    <td colSpan={5} className="px-3 py-1.5">
                      Total inventory value
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(computedValue)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Variance JE */}
        {materialVariance ? (
          <section>
            <div className="rounded border border-amber-200 bg-amber-50/40">
              <div className="border-b border-amber-200 px-4 py-2 text-sm font-semibold text-amber-900">
                Adjusting Journal Entry
              </div>
              <div className="px-4 py-3 space-y-2 text-sm">
                <div className="text-xs text-amber-800">
                  {variance > 0
                    ? `GL is overstated by ${fmt(Math.abs(variance))} vs the valued stock on hand — write down.`
                    : `GL is understated by ${fmt(Math.abs(variance))} vs the valued stock on hand — write up.`}
                </div>
                <table className="mt-2 w-full text-sm">
                  <thead className="text-slate-600">
                    <tr>
                      <th className="text-left font-medium py-1 w-[80px]">BC #</th>
                      <th className="text-left font-medium py-1">Account</th>
                      <th className="text-right font-medium py-1 w-[130px]">Debit</th>
                      <th className="text-right font-medium py-1 w-[130px]">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="border-t border-amber-200">
                    {variance > 0 ? (
                      <>
                        <JeRow
                          account={
                            adjustmentAccount
                              ? {
                                  number: adjustmentAccount.number,
                                  displayName: adjustmentAccount.displayName,
                                }
                              : null
                          }
                          fallbackName="Inventory Adjustment Expense"
                          debit={Math.abs(variance)}
                          credit={0}
                        />
                        <JeRow
                          account={
                            primaryInventoryAccount
                              ? {
                                  number: primaryInventoryAccount.number,
                                  displayName: primaryInventoryAccount.displayName,
                                }
                              : null
                          }
                          fallbackName="Inventory"
                          debit={0}
                          credit={Math.abs(variance)}
                        />
                      </>
                    ) : (
                      <>
                        <JeRow
                          account={
                            primaryInventoryAccount
                              ? {
                                  number: primaryInventoryAccount.number,
                                  displayName: primaryInventoryAccount.displayName,
                                }
                              : null
                          }
                          fallbackName="Inventory"
                          debit={Math.abs(variance)}
                          credit={0}
                        />
                        <JeRow
                          account={
                            adjustmentAccount
                              ? {
                                  number: adjustmentAccount.number,
                                  displayName: adjustmentAccount.displayName,
                                }
                              : null
                          }
                          fallbackName="Inventory Adjustment Expense"
                          debit={0}
                          credit={Math.abs(variance)}
                        />
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : (
          <div className="rounded border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm text-emerald-900">
            ✓ Inventory GL ({fmt(glBalance)}) ties to valued stock on hand ({fmt(computedValue)}).
            No adjusting JE required.
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

function JeRow({
  account,
  fallbackName,
  debit,
  credit,
}: {
  account: { number: string; displayName: string } | null;
  fallbackName: string;
  debit: number;
  credit: number;
}) {
  return (
    <tr>
      <td className="py-1 font-mono text-[11px] text-slate-500">{account?.number ?? "—"}</td>
      <td className="py-1">
        {account?.displayName ?? (
          <span className="italic text-slate-400">{fallbackName} (unassigned)</span>
        )}
      </td>
      <td className="py-1 text-right tabular-nums">{debit === 0 ? "—" : fmt(debit)}</td>
      <td className="py-1 text-right tabular-nums">{credit === 0 ? "—" : fmt(credit)}</td>
    </tr>
  );
}
