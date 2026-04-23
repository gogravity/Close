import { getEntityConfig } from "@/lib/settings";
import BudgetVsActualClient from "./BudgetVsActualClient";

export const dynamic = "force-dynamic";

function defaultRange(periodEnd: string): { start: string; end: string } {
  // Default to YTD ending at the selected period (or current calendar year).
  const y =
    periodEnd && /^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
      ? Number(periodEnd.slice(0, 4))
      : new Date().getUTCFullYear();
  const endM =
    periodEnd && /^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
      ? periodEnd.slice(0, 7)
      : `${y}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
  return { start: `${y}-01`, end: endM };
}

export default async function BudgetVsActualPage() {
  const entity = await getEntityConfig();
  const { start, end } = defaultRange(entity.periodEnd);
  return (
    <div className="px-8 py-8 max-w-[1400px]">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">Data Preparation</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Budget vs Actual</h1>
        <p className="mt-1 text-sm text-slate-600">
          P&amp;L actuals against a selected BC G/L Budget for a date range you choose.
          Variance computed at the account level. Pulls from the BC <code>reportsFinance/beta</code>{" "}
          financial reporting API.
        </p>
      </header>
      {entity.bcConfigured ? (
        <BudgetVsActualClient defaultStartMonth={start} defaultEndMonth={end} />
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Business Central must be configured in{" "}
          <a className="underline" href="/settings">
            Settings
          </a>
          .
        </div>
      )}
    </div>
  );
}
