import Link from "next/link";
import { redirect } from "next/navigation";
import { getEntityConfig } from "@/lib/settings";
import { findSection } from "@/lib/recon";
import UnbilledTimePane from "./UnbilledTimePane";

export const dynamic = "force-dynamic";

const SUBTAB_ORDER = [
  "Unbilled Revenue Rec",
  "Unbilled Time / Labor",
  "Unbilled Cloud (Recurring)",
  "Unbilled Cloud (Non-Recurring)",
] as const;

type Subtab = (typeof SUBTAB_ORDER)[number];

function parseSubtab(v: string | undefined): Subtab {
  if (!v) return "Unbilled Time / Labor";
  const lower = v.toLowerCase();
  const match = SUBTAB_ORDER.find((s) => s.toLowerCase() === lower);
  return match ?? "Unbilled Time / Labor";
}

export default async function UnbilledRevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const entity = await getEntityConfig();
  if (!entity.bcConfigured || !entity.cwConfigured) redirect("/onboarding");
  const section = findSection("unbilled-revenue");
  const params = await searchParams;
  const activeTab = parseSubtab(params.tab);

  return (
    <div className="px-8 py-8 max-w-[1500px]">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
        ← Balance Sheet Summary
      </Link>
      <header className="mt-3 mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          Section {section?.order ?? 12} · Period ending {entity.periodEnd}
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          {section?.title ?? "Unbilled Revenue"}
        </h1>
      </header>

      <nav className="mb-6 border-b border-slate-200">
        <ul className="flex gap-1 -mb-px">
          {SUBTAB_ORDER.map((t) => {
            const isActive = t === activeTab;
            return (
              <li key={t}>
                <Link
                  href={`/section/unbilled-revenue?tab=${encodeURIComponent(t)}`}
                  className={`block px-3 py-2 text-sm border-b-2 ${
                    isActive
                      ? "border-slate-900 text-slate-900 font-medium"
                      : "border-transparent text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {t}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {activeTab === "Unbilled Time / Labor" ? (
        <UnbilledTimePane periodEnd={entity.periodEnd} />
      ) : (
        <ComingSoon tab={activeTab} />
      )}
    </div>
  );
}

function ComingSoon({ tab }: { tab: string }) {
  return (
    <div className="rounded border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
      <div className="font-medium text-slate-700">{tab}</div>
      <div className="mt-1">Coming soon.</div>
    </div>
  );
}
