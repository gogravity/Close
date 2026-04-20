import Link from "next/link";
import { redirect } from "next/navigation";
import { getEntityConfig } from "@/lib/settings";
import { findSection } from "@/lib/recon";
import AccruedPayrollClient from "./AccruedPayrollClient";

export const dynamic = "force-dynamic";

export default async function AccruedPayrollPage() {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");
  const section = findSection("accrued-payroll");

  return (
    <div className="px-8 py-8 max-w-[1500px]">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
        ← Balance Sheet Summary
      </Link>
      <header className="mt-3 mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          Section {section?.order ?? 8} · Period ending {entity.periodEnd}
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          {section?.title ?? "Accrued Payroll"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Reconciles account 202010 Accrued Wages. Drafted JE is populated from the
          Payroll Allocation tool — run that workflow and click <span className="font-semibold">
          Copy to Accrued Payroll Report</span> to push the data here.
        </p>
      </header>
      <AccruedPayrollClient periodEnd={entity.periodEnd} />
    </div>
  );
}
