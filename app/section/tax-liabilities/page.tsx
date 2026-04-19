import Link from "next/link";
import { redirect } from "next/navigation";
import { findSection } from "@/lib/recon";
import { getEntityConfig, getAccountMappings } from "@/lib/settings";
import {
  listAccounts,
  getAccountBalances,
  BusinessCentralError,
} from "@/lib/businessCentral";
import { getInputsForPeriod } from "@/lib/taxRecon";
import TaxReconClient, { type TaxAccount } from "./TaxReconClient";

export const dynamic = "force-dynamic";

export default async function TaxLiabilitiesSectionPage() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");
  const section = findSection("tax-liabilities")!;

  try {
    const [accounts, balances, mappings, inputs] = await Promise.all([
      listAccounts(),
      getAccountBalances(entity.periodEnd),
      getAccountMappings(),
      getInputsForPeriod(entity.periodEnd),
    ]);

    const taxAccountNumbers = Object.entries(mappings)
      .filter(([, slug]) => slug === "tax-liabilities")
      .map(([num]) => num);
    const taxAccounts = accounts.filter((a) => taxAccountNumbers.includes(a.number));

    const offsetAccount =
      accounts.find(
        (a) =>
          (a.category === "Expense" || a.category === "CostOfGoodsSold") &&
          /sales\s*tax|tax\s*expense/i.test(a.displayName)
      ) ?? null;

    const taxAccountsForClient: TaxAccount[] = taxAccounts.map((a) => ({
      bcAccountNumber: a.number,
      bcDisplayName: a.displayName,
      glBalance: balances.get(a.number) ?? 0,
      initial: {
        filedLiability: inputs[a.number]?.filedLiability ?? null,
        adjustment: inputs[a.number]?.adjustment ?? null,
      },
    }));

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
            <p className="mt-1 text-sm text-slate-600">
              Enter the total liability from your compliance-filing report and any known
              reconciling adjustment. The app computes the expected GL balance and flags any
              remaining difference.
            </p>
          </div>
          <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            Live · BC
          </span>
        </header>

        {taxAccounts.length === 0 ? (
          <div className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
            No BC accounts mapped to this section.{" "}
            <Link href="/mapping" className="text-blue-600 hover:underline">
              Go to Account Mapping
            </Link>{" "}
            to add one.
          </div>
        ) : (
          <TaxReconClient
            periodEnd={entity.periodEnd}
            accounts={taxAccountsForClient}
            offsetAccount={
              offsetAccount
                ? { number: offsetAccount.number, displayName: offsetAccount.displayName }
                : null
            }
          />
        )}

        <div className="mt-8 rounded border border-dashed border-slate-300 px-4 py-3 text-xs text-slate-500">
          <strong>Next step (pinned for later):</strong> pull sales-tax-by-jurisdiction detail
          from BC to populate the taxable/exempt/nontaxable breakdown per jurisdiction like
          your Excel{" "}
          <em>Sales Tax</em> tab. BC v2.0 doesn&apos;t expose the jurisdiction aggregation
          directly — we&apos;ll need to iterate over posted sales invoices and bucket by tax
          group and customer state.
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
