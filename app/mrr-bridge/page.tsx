import { getEntityConfig, getSettingsSnapshot } from "@/lib/settings";
import MrrBridgeClient from "./MrrBridgeClient";

export const dynamic = "force-dynamic";

function defaultMonths(periodEnd: string): { priorMonth: string; currentMonth: string } {
  let cy: number;
  let cm: number; // 1-12
  if (/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    const [y, m] = periodEnd.split("-").map(Number);
    cy = y; cm = m;
  } else {
    const now = new Date();
    cy = now.getUTCFullYear();
    cm = now.getUTCMonth() + 1;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const currentMonth = `${cy}-${pad(cm)}`;
  const priorDate = new Date(Date.UTC(cy, cm - 2, 1));
  const priorMonth = `${priorDate.getUTCFullYear()}-${pad(priorDate.getUTCMonth() + 1)}`;
  return { priorMonth, currentMonth };
}

export default async function MrrBridgePage() {
  const entity = await getEntityConfig();
  const snapshot = await getSettingsSnapshot();
  const hubspotConfigured = Boolean(
    snapshot.integrations.find((i) => i.id === "hubspot")?.configured
  );
  const periods = defaultMonths(entity.periodEnd);

  return (
    <div className="px-8 py-8 max-w-[1500px]">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">MRR Bridge</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          Monthly Recurring Revenue Bridge
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Compares MRR between two consecutive months using BC GL entries on
          the recurring-revenue accounts (400010 / 402010 / 402030 / 402040 /
          402050) as source of truth, with customer + agreement context
          resolved via CW invoices, BC sales invoices (Datagate VoIP), BC
          credit memos, and JE-description parsing. HubSpot Closed-Won deals
          feed signed-not-onboarded pipeline.
        </p>
      </header>

      {entity.bcConfigured && entity.cwConfigured ? (
        <MrrBridgeClient
          defaultPriorMonth={periods.priorMonth}
          defaultCurrentMonth={periods.currentMonth}
          hubspotConfigured={hubspotConfigured}
        />
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Business Central and ConnectWise must be configured in{" "}
          <a className="underline" href="/settings">
            Settings
          </a>{" "}
          before the MRR bridge can compute.
        </div>
      )}
    </div>
  );
}
