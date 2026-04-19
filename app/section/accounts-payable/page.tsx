import Link from "next/link";
import { redirect } from "next/navigation";
import { findSection, fmt } from "@/lib/recon";
import { getEntityConfig, getAccountMappings } from "@/lib/settings";
import {
  listAccounts,
  getAccountBalances,
  getAgedPayables,
  listOpenIntercompanyApInvoices,
  BusinessCentralError,
} from "@/lib/businessCentral";
import ApAgingPane from "./ApAgingPane";
import IntercompanyApPane from "./IntercompanyApPane";

export const dynamic = "force-dynamic";

type TabKey = "rec" | "aging" | "intercompany";

export default async function ApSectionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const activeTab: TabKey = (params.tab as TabKey | undefined) ?? "rec";

  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");
  const section = findSection("accounts-payable")!;

  try {
    const [accounts, balances, mappings, aging, intercompanyInvoices] = await Promise.all([
      listAccounts(),
      getAccountBalances(entity.periodEnd),
      getAccountMappings(),
      getAgedPayables(),
      listOpenIntercompanyApInvoices(),
    ]);

    // Identify key GL accounts for the intercompany reclass JE.
    // AP: first liability account whose name is "Accounts Payable" (not adjustment).
    const apGlAccount =
      accounts.find(
        (a) =>
          a.category === "Liabilities" &&
          /^accounts\s*payable$/i.test(a.displayName.trim())
      ) ??
      accounts.find(
        (a) =>
          a.category === "Liabilities" &&
          /accounts\s*payable/i.test(a.displayName) &&
          !/adjust/i.test(a.displayName)
      ) ??
      null;
    // Intercompany reclass target: account 117950 ("Due to/from Lyra").
    // BC classifies it under Assets, but it functions as a net payable to the
    // parent/Lyra companies — balance swings between receivable and payable.
    // Match by account number first; fall back to name-based detection.
    const icGlAccount =
      accounts.find((a) => a.number === "117950") ??
      accounts.find((a) =>
        /due\s*to.*(parent|lyra)|intercompany.*(payable|loan)/i.test(a.displayName)
      ) ??
      null;

    const icInvoicesForPane = intercompanyInvoices.map((inv) => {
      const icDim = (inv.dimensionSetLines || []).find((d) => d.code === "INTERCOMPANY");
      return {
        id: inv.id,
        number: inv.number,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        vendorName: inv.vendorName,
        totalAmountIncludingTax: inv.totalAmountIncludingTax,
        remainingAmount: inv.remainingAmount,
        intercompanyCode: icDim?.valueCode ?? "",
        intercompanyName: icDim?.valueDisplayName ?? "",
      };
    });

    const apAccountNumbers = Object.entries(mappings)
      .filter(([, slug]) => slug === "accounts-payable")
      .map(([num]) => num);
    const apAccounts = accounts.filter((a) => apAccountNumbers.includes(a.number));
    const glBalance = apAccounts.reduce(
      (s, a) => s + (balances.get(a.number) ?? 0),
      0
    );

    // Payables are negative in GL (liabilities). Flip for comparison against
    // the aging total which is always positive.
    const glAbs = Math.abs(glBalance);
    const variance = glAbs - aging.total.balanceDue;

    return (
      <div className="px-8 py-8 max-w-6xl">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
          ← Balance Sheet Summary
        </Link>
        <header className="mt-3 mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Section {section.order} · Period ending {entity.periodEnd}
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">
              AP Rec &amp; Analysis
            </h1>
          </div>
          <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            Live · BC
          </span>
        </header>

        <nav className="mb-6 flex gap-1 border-b border-slate-200">
          <TabLink href="/section/accounts-payable" active={activeTab === "rec"}>
            AP Rec &amp; Analysis
          </TabLink>
          <TabLink
            href="/section/accounts-payable?tab=aging"
            active={activeTab === "aging"}
          >
            AP Aging
          </TabLink>
          <TabLink
            href="/section/accounts-payable?tab=intercompany"
            active={activeTab === "intercompany"}
          >
            Intercompany ({icInvoicesForPane.length})
          </TabLink>
        </nav>

        {activeTab === "rec" && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <Panel label="AP Balance (GL)" value={fmt(glBalance)} tone="neutral" />
              <Panel
                label="Aging Total (BC)"
                value={fmt(-aging.total.balanceDue)}
                tone="neutral"
              />
              <Panel
                label="Variance"
                value={fmt(variance)}
                tone={Math.abs(variance) < 0.01 ? "ok" : "warn"}
              />
            </div>

            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Mapped GL accounts ({apAccounts.length})
              </h2>
              <div className="overflow-hidden rounded border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium w-[90px]">BC #</th>
                      <th className="px-3 py-2 text-left font-medium">Account</th>
                      <th className="px-3 py-2 text-right font-medium">GL balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apAccounts.map((a) => (
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
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {fmt(glBalance)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Aging buckets — as of {aging.asOfDate} ({aging.periodLengthFilter})
              </h2>
              <div className="overflow-hidden rounded border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Bucket</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                      <th className="px-4 py-2 text-right font-medium">% of AP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        { label: "Current", amt: aging.total.current },
                        { label: "31 - 60 days", amt: aging.total.period1 },
                        { label: "61 - 90 days", amt: aging.total.period2 },
                        { label: "Over 90 days", amt: aging.total.period3 },
                      ] as const
                    ).map((r) => {
                      const pct =
                        aging.total.balanceDue !== 0
                          ? r.amt / aging.total.balanceDue
                          : 0;
                      return (
                        <tr key={r.label} className="border-t border-slate-100">
                          <td className="px-4 py-1.5">{r.label}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums">
                            {fmt(r.amt)}
                          </td>
                          <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">
                            {(pct * 100).toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                      <td className="px-4 py-1.5">AP balance per aging</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">
                        {fmt(aging.total.balanceDue)}
                      </td>
                      <td className="px-4 py-1.5 text-right">100.00%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {Math.abs(variance) >= 0.01 ? (
              <div className="rounded border border-amber-200 bg-amber-50/40 px-4 py-3 text-sm text-amber-900">
                Variance {fmt(variance)} between GL ({fmt(glAbs)}) and aging total (
                {fmt(aging.total.balanceDue)}). Likely due to BC&apos;s aging endpoint
                returning today&apos;s state rather than period-end — will tighten when we
                add period-end filtering.
              </div>
            ) : (
              <div className="rounded border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm text-emerald-900">
                ✓ GL ties to aging total.
              </div>
            )}
          </div>
        )}

        {activeTab === "intercompany" && (
          <IntercompanyApPane
            invoices={icInvoicesForPane}
            apAccount={
              apGlAccount
                ? { number: apGlAccount.number, displayName: apGlAccount.displayName }
                : null
            }
            intercompanyAccount={
              icGlAccount
                ? { number: icGlAccount.number, displayName: icGlAccount.displayName }
                : null
            }
          />
        )}

        {activeTab === "aging" && (
          <ApAgingPane
            asOfDate={aging.asOfDate}
            periodLengthFilter={aging.periodLengthFilter}
            totals={aging.total}
            vendors={aging.vendors.map((v) => ({
              vendorNumber: v.vendorNumber,
              name: v.name,
              balanceDue: v.balanceDue,
              currentAmount: v.currentAmount,
              period1Amount: v.period1Amount,
              period2Amount: v.period2Amount,
              period3Amount: v.period3Amount,
            }))}
          />
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

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`relative rounded-t border-t border-x px-4 py-2 text-sm ${
        active
          ? "border-slate-300 bg-white text-slate-900 font-medium -mb-px"
          : "border-transparent text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </Link>
  );
}
