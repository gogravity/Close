import { redirect } from "next/navigation";
import { getSettingsSnapshot, getEntityConfig } from "@/lib/settings";
import OnboardingWizard from "./OnboardingWizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const entity = await getEntityConfig();
  if (entity.bcConfigured && entity.cwConfigured) redirect("/");

  const snapshot = await getSettingsSnapshot();
  return (
    <div className="px-8 py-10 max-w-3xl">
      <header className="mb-8">
        <div className="text-xs uppercase tracking-wide text-slate-500">Getting Started</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          Connect your systems of record
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Balance-sheet reconciliation starts from your general ledger and your PSA. Connect
          both to continue, then optionally add Ramp, Gusto, and Anthropic.
        </p>
      </header>
      <OnboardingWizard initial={snapshot} />
    </div>
  );
}
