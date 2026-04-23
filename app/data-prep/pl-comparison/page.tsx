import { getEntityConfig } from "@/lib/settings";
import PlReportsTabs from "./PlReportsTabs";

export const dynamic = "force-dynamic";

function defaultEndMonth(periodEnd: string): string {
  // periodEnd is "YYYY-MM-DD". Use its month if present; otherwise the previous
  // calendar month (freshest closed month for most entities).
  if (periodEnd && /^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return periodEnd.slice(0, 7);
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function PlComparisonPage() {
  const entity = await getEntityConfig();
  const endMonth = defaultEndMonth(entity.periodEnd);
  return (
    <div className="px-8 py-8 max-w-[1400px]">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">Data Preparation</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">P&amp;L Reports</h1>
        <p className="mt-1 text-sm text-slate-600">
          Monthly P&amp;L comparison and a pivot by subaccount / department with
          month-over-month variance.
        </p>
      </header>
      {entity.bcConfigured ? (
        <PlReportsTabs defaultEndMonth={endMonth} />
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Business Central must be configured in{" "}
          <a className="underline" href="/settings">
            Settings
          </a>{" "}
          before running P&amp;L reports.
        </div>
      )}
    </div>
  );
}
