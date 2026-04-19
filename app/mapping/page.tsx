import { redirect } from "next/navigation";
import { getEntityConfig } from "@/lib/settings";
import { listAccounts, getAccountBalances, BusinessCentralError } from "@/lib/businessCentral";
import { getAccountMappings } from "@/lib/settings";
import MappingEditor from "./MappingEditor";

export const dynamic = "force-dynamic";

export default async function MappingPage() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");

  try {
    const [accounts, mappings, balances] = await Promise.all([
      listAccounts(),
      getAccountMappings(),
      getAccountBalances(entity.periodEnd).catch(() => new Map<string, number>()),
    ]);
    const payload = {
      periodEnd: entity.periodEnd,
      accounts: accounts.map((a) => ({
        id: a.id,
        number: a.number,
        displayName: a.displayName,
        category: a.category,
        subCategory: a.subCategory,
        balance: balances.get(a.number) ?? 0,
        mappedTo: mappings[a.number] ?? null,
      })),
    };
    return (
      <div className="px-8 py-8 max-w-6xl">
        <header className="mb-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Configuration</div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">
            Account Mapping
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Assign each posting GL account from Business Central to a reconciliation section.
            Accounts you exclude won&apos;t appear in any section or in the Balance Sheet
            summary. Auto-suggest maps common BC sub-categories (<em>Cash</em>,{" "}
            <em>Accounts Receivable</em>, etc.) to the matching section.
          </p>
        </header>
        <MappingEditor initial={payload} />
      </div>
    );
  } catch (err) {
    if (err instanceof BusinessCentralError) {
      return (
        <div className="px-8 py-8 max-w-3xl">
          <h1 className="text-xl font-semibold text-red-700">Failed to load accounts</h1>
          <pre className="mt-3 rounded bg-slate-100 p-3 text-xs">
            {err.message}
            {err.body ? `\n\n${JSON.stringify(err.body, null, 2)}` : ""}
          </pre>
        </div>
      );
    }
    throw err;
  }
}
