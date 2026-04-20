import { getEntityConfig } from "@/lib/settings";
import { currentPayPeriodFor } from "@/lib/payroll";
import PayrollClient from "./PayrollClient";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const entity = await getEntityConfig();
  // Default to the most recently completed pay half rather than the in-flight
  // one — closing out the prior period is what accounting actually looks at.
  const now = new Date();
  const prior = new Date(now.getTime());
  prior.setUTCDate(prior.getUTCDate() - 15);
  const initial = currentPayPeriodFor(prior);

  return (
    <div className="px-8 py-8 max-w-[1500px]">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">Data Preparation</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Payroll Allocation</h1>
        <p className="mt-1 text-sm text-slate-600">
          Splits each CW member&apos;s time in the selected pay period across COGS buckets
          (Managed Services, Re-occurring, Non-recurring, VOIP) and SG&amp;A buckets (Sales,
          Admin). Pick each person&apos;s department — Sales and Admin members use a fixed
          40×2=80 hr baseline with the remainder going to their dept bucket; everyone else
          is allocated against their actual tracked hours.
        </p>
      </header>
      {entity.cwConfigured ? (
        <PayrollClient defaultYear={initial.year} defaultMonth={initial.month} defaultHalf={initial.half} />
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ConnectWise must be configured in{" "}
          <a className="underline" href="/settings">
            Settings
          </a>{" "}
          before the payroll allocation can run.
        </div>
      )}
    </div>
  );
}
