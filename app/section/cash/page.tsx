import Link from "next/link";
import { redirect } from "next/navigation";
import { getEntityConfig, getAccountMappings } from "@/lib/settings";
import { listAccounts, getAccountBalances } from "@/lib/businessCentral";
import { getCashReconInput } from "@/lib/cashRecon";
import { findSection } from "@/lib/recon";
import CashReconClient, { type ReconAccount } from "./CashReconClient";

export const dynamic = "force-dynamic";

export default async function CashSectionPage() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");

  const section = findSection("cash")!;

  const [accounts, balances, mappings] = await Promise.all([
    listAccounts(),
    getAccountBalances(entity.periodEnd),
    getAccountMappings(),
  ]);

  const cashAccountNumbers = Object.entries(mappings)
    .filter(([, slug]) => slug === "cash")
    .map(([number]) => number);
  const cashAccounts = accounts.filter((a) => cashAccountNumbers.includes(a.number));

  const reconAccounts: ReconAccount[] = await Promise.all(
    cashAccounts.map(async (a) => {
      const input = await getCashReconInput(entity.periodEnd, a.number);
      return {
        bcAccountNumber: a.number,
        bcDisplayName: a.displayName,
        unadjustedGL: balances.get(a.number) ?? 0,
        input,
      };
    })
  );

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
            One reconciliation sub-tab per bank or cash account mapped to this section. Upload
            the statement PDF to auto-extract the ending balance.
          </p>
        </div>
        <span className="shrink-0 rounded border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-teal-800">
          {reconAccounts.length} account{reconAccounts.length === 1 ? "" : "s"}
        </span>
      </header>

      <CashReconClient periodEnd={entity.periodEnd} accounts={reconAccounts} />
    </div>
  );
}
