import Link from "next/link";
import { redirect } from "next/navigation";
import { findSection } from "@/lib/recon";
import { getEntityConfig, getAccountMappings } from "@/lib/settings";
import {
  listAccounts,
  getAccountBalances,
  getAgedReceivables,
  listGlEntries,
  listOpenCustomerLedgerEntries,
  BusinessCentralError,
} from "@/lib/businessCentral";
import { listInvoices } from "@/lib/connectwise";
import { getArReconInput } from "@/lib/arRecon";
import ArReconClient from "./ArReconClient";
import AltPaymentsPane from "./AltPaymentsPane";
import ArAgingPane from "./ArAgingPane";

export const dynamic = "force-dynamic";

function periodStartOf(periodEnd: string): string {
  const d = new Date(periodEnd);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}


type TabKey = "rec" | "aging" | "alt-payments" | "alt-activity";

export default async function ArSectionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; account?: string }>;
}) {
  const params = await searchParams;
  let activeTab: TabKey = (params.tab as TabKey | undefined) ?? "rec";
  if (params.account === "100140" && !params.tab) activeTab = "alt-payments";
  const account = params.account;
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");

  const section = findSection("accounts-receivable")!;

  try {
    const periodEnd = entity.periodEnd;
    const periodStart = periodStartOf(periodEnd);

    // Use a wide CW lookback to catch all open invoices regardless of age
    const cwLookbackStart = `${new Date().getUTCFullYear() - 3}-01-01`;

    const [accounts, balances, mappings, aging, input, cwInvoicesRaw, bcLedgerRaw] =
      await Promise.all([
        listAccounts(),
        getAccountBalances(periodEnd),
        getAccountMappings(),
        getAgedReceivables(),
        getArReconInput(periodEnd),
        listInvoices(cwLookbackStart, periodEnd).catch(() => []),
        // BC Customer Ledger Entries — all open entries, includes invoices + credit memos
        listOpenCustomerLedgerEntries().catch(() => []),
      ]);

    // CW: open invoices (balance > 0)
    const cwOpenInvoices = cwInvoicesRaw
      .filter((inv) => (inv.balance ?? 0) > 0.005)
      .map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        date: inv.date.slice(0, 10),
        dueDate: inv.dueDate?.slice(0, 10) ?? "",
        companyName: inv.company?.name ?? "",
        total: (inv.total ?? 0) + (inv.salesTax ?? 0),
        balance: inv.balance ?? 0,
      }));

    // BC: open customer ledger entries — invoices, credit memos, all AR entries
    const bcOpenInvoices = bcLedgerRaw.map((e) => ({
      id: e.id,
      documentType: e.documentType,
      documentNumber: e.documentNumber,
      externalDocumentNumber: e.externalDocumentNumber ?? "",
      postingDate: e.postingDate,
      dueDate: e.dueDate ?? "",
      customerNumber: e.customerNumber,
      customerName: e.customerName,
      description: e.description ?? "",
      amount: e.amount,
      remainingAmount: e.remainingAmount,
    }));

    const arAccountNumbers = Object.entries(mappings)
      .filter(([, slug]) => slug === "accounts-receivable")
      .map(([num]) => num);
    const arAccounts = accounts.filter((a) => arAccountNumbers.includes(a.number));

    const isAllowance = (name: string) => /allowance/i.test(name);
    const allowanceAcct = arAccounts.find((a) => isAllowance(a.displayName));
    const paymentGatewayAccts = arAccounts.filter((a) => a.subCategory === "Cash");
    const arPostingAccounts = arAccounts.filter(
      (a) => !isAllowance(a.displayName) && a.subCategory !== "Cash"
    );

    const arGlBalance = arPostingAccounts.reduce(
      (s, a) => s + (balances.get(a.number) ?? 0),
      0
    );
    const allowanceGlBalance = allowanceAcct ? balances.get(allowanceAcct.number) ?? 0 : 0;

    const gatewayAccount = paymentGatewayAccts[0] ?? null;
    const needsGatewayData =
      activeTab === "alt-payments" || activeTab === "alt-activity";
    void account;

    const priorPeriodEndDate = new Date(periodStart);
    priorPeriodEndDate.setUTCDate(priorPeriodEndDate.getUTCDate() - 1);
    const priorDateStr = priorPeriodEndDate.toISOString().slice(0, 10);
    const priorBalances =
      needsGatewayData && gatewayAccount
        ? await getAccountBalances(priorDateStr)
        : new Map<string, number>();
    const gatewayEntries =
      needsGatewayData && gatewayAccount
        ? await listGlEntries(gatewayAccount.number, periodStart, periodEnd)
        : [];
    const gatewayDisplayName = gatewayAccount
      ? gatewayAccount.displayName === "Checking"
        ? "Alternative Payments"
        : gatewayAccount.displayName
      : null;

    return (
      <div className="px-8 py-8 max-w-6xl">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
          ← Balance Sheet Summary
        </Link>
        <header className="mt-3 mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Section {section.order} · Period ending {periodEnd}
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">{section.title}</h1>
          </div>
          <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            Live · BC
          </span>
        </header>

        <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">
          <TabLink href="/section/accounts-receivable" active={activeTab === "rec"}>
            AR Rec & Analysis
          </TabLink>
          <TabLink href="/section/accounts-receivable?tab=aging" active={activeTab === "aging"}>
            AR Aging
          </TabLink>
          {gatewayAccount && (
            <>
              <TabLink
                href="/section/accounts-receivable?tab=alt-payments"
                active={activeTab === "alt-payments"}
              >
                Alternative Payments
              </TabLink>
              <TabLink
                href="/section/accounts-receivable?tab=alt-activity"
                active={activeTab === "alt-activity"}
              >
                Alt Pmt BC Activity
              </TabLink>
            </>
          )}
        </nav>

        {activeTab === "rec" && (
          <ArReconClient
            periodEnd={periodEnd}
            asOfDate={aging.asOfDate}
            periodLengthFilter={aging.periodLengthFilter}
            totals={aging.total}
            customers={aging.customers.map((c) => ({
              customerNumber: c.customerNumber,
              name: c.name,
              balanceDue: c.balanceDue,
              currentAmount: c.currentAmount,
              period1Amount: c.period1Amount,
              period2Amount: c.period2Amount,
              period3Amount: c.period3Amount,
            }))}
            arGlBalance={arGlBalance}
            allowanceAccount={
              allowanceAcct
                ? { number: allowanceAcct.number, displayName: allowanceAcct.displayName }
                : null
            }
            allowanceGlBalance={allowanceGlBalance}
            badDebtAccount={(() => {
              const match = accounts.find(
                (a) =>
                  (a.category === "Expense" || a.category === "CostOfGoodsSold") &&
                  /bad\s*debt/i.test(a.displayName)
              );
              return match
                ? { number: match.number, displayName: match.displayName }
                : null;
            })()}
            initialInput={input}
            cwOpenInvoices={cwOpenInvoices}
            bcOpenInvoices={bcOpenInvoices}
            hideCustomerDetail
          />
        )}

        {activeTab === "aging" && (
          <ArAgingPane
            asOfDate={aging.asOfDate}
            periodLengthFilter={aging.periodLengthFilter}
            totals={aging.total}
            customers={aging.customers.map((c) => ({
              customerNumber: c.customerNumber,
              name: c.name,
              balanceDue: c.balanceDue,
              currentAmount: c.currentAmount,
              period1Amount: c.period1Amount,
              period2Amount: c.period2Amount,
              period3Amount: c.period3Amount,
            }))}
          />
        )}

        {activeTab === "alt-payments" && gatewayAccount && gatewayDisplayName && (
          <AltPaymentsPane
            view="summary"
            periodStart={periodStart}
            periodEnd={periodEnd}
            bcAccountNumber={gatewayAccount.number}
            bcDisplayName={gatewayDisplayName}
            endingBalance={balances.get(gatewayAccount.number) ?? 0}
            openingBalance={priorBalances.get(gatewayAccount.number) ?? 0}
            entries={gatewayEntries}
          />
        )}

        {activeTab === "alt-activity" && gatewayAccount && gatewayDisplayName && (
          <AltPaymentsPane
            view="activity"
            periodStart={periodStart}
            periodEnd={periodEnd}
            bcAccountNumber={gatewayAccount.number}
            bcDisplayName={gatewayDisplayName}
            endingBalance={balances.get(gatewayAccount.number) ?? 0}
            openingBalance={priorBalances.get(gatewayAccount.number) ?? 0}
            entries={gatewayEntries}
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
