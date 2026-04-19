import Link from "next/link";
import { Suspense } from "react";
import { sections } from "@/lib/recon";
import { getEntityConfig, getAccountMappings } from "@/lib/settings";
import { listAccounts, BusinessCentralError } from "@/lib/businessCentral";
import SidebarNav, { type SidebarSection } from "./SidebarNav";

export default async function Sidebar() {
  const { name, periodEnd } = await getEntityConfig();

  // Build sub-tabs per section from the user's /mapping assignments.
  // If BC isn't reachable we fall back to sections with no sub-tabs (the
  // nav still renders, just without the expandable children).
  let navSections: SidebarSection[] = sections.map((s) => ({
    slug: s.slug,
    title: s.title,
    order: s.order,
    subTabs: [],
  }));
  try {
    const [accounts, mappings] = await Promise.all([listAccounts(), getAccountMappings()]);
    const byNumber = new Map(accounts.map((a) => [a.number, a]));
    navSections = sections.map((s) => {
      // Sections that don't expose per-account tabs get no sub-tabs in the
      // sidebar — they have their own in-page tab strips instead.
      if (!s.showAccountSubTabs) {
        return { slug: s.slug, title: s.title, order: s.order, subTabs: [] };
      }
      const subAccounts = Object.entries(mappings)
        .filter(([, slug]) => slug === s.slug)
        .map(([num]) => byNumber.get(num))
        .filter((a): a is NonNullable<typeof a> => Boolean(a))
        .sort((a, b) => {
          // Payment-gateway accounts (BC sub-category "Cash" mapped into a
          // non-cash section) sort last within the section.
          const aIsGateway = s.slug !== "cash" && a.subCategory === "Cash";
          const bIsGateway = s.slug !== "cash" && b.subCategory === "Cash";
          if (aIsGateway !== bIsGateway) return aIsGateway ? 1 : -1;
          return a.number.localeCompare(b.number);
        });
      return {
        slug: s.slug,
        title: s.title,
        order: s.order,
        subTabs: subAccounts.map((a) => {
          // BC often ships every cash-like account with displayName="Checking";
          // when such an account is mapped into a non-cash section, relabel it
          // with the section title so the sidebar doesn't show a row of
          // identical "Checking" entries.
          const isGenericCash =
            s.slug !== "cash" && a.subCategory === "Cash" && /^checking$/i.test(a.displayName);
          return {
            accountNumber: a.number,
            accountName: isGenericCash ? "Alternative Payments" : a.displayName,
          };
        }),
      };
    });
  } catch (err) {
    if (!(err instanceof BusinessCentralError)) throw err;
  }

  return (
    <aside className="w-72 shrink-0 border-r border-slate-200 bg-slate-50 overflow-y-auto">
      <div className="p-5 border-b border-slate-200">
        <div className="text-xs uppercase tracking-wide text-slate-500">Monthly Close</div>
        <div className="mt-1 font-semibold text-slate-900">{name || "Unconfigured entity"}</div>
        <div className="mt-0.5 text-sm text-slate-600">
          {periodEnd ? `Period ending ${periodEnd}` : "Set a period end in Settings"}
        </div>
      </div>
      <nav className="p-3">
        <Link
          href="/"
          className="block rounded px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-200"
        >
          Balance Sheet Summary
        </Link>
        <div className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Data Preparation
        </div>
        <ul className="mt-1 space-y-0.5">
          <li>
            <Link
              href="/data-prep/invoice-validation"
              className="block rounded px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 hover:text-slate-900"
            >
              Invoice Validation
            </Link>
          </li>
          <li>
            <Link
              href="/data-prep/pl-comparison"
              className="block rounded px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 hover:text-slate-900"
            >
              P&amp;L Comparison
            </Link>
          </li>
        </ul>
        <div className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Balance Sheet Reconciliation
        </div>
        <Suspense fallback={<ul className="mt-1 space-y-0.5" />}>
          <SidebarNav sections={navSections} />
        </Suspense>
        <div className="mt-4 space-y-0.5 border-t border-slate-200 pt-3">
          <Link
            href="/export"
            className="block rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            ⬇ Export Close Package
          </Link>
          <Link
            href="/plan"
            className="block rounded px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 hover:text-slate-900"
          >
            Recon Plan
          </Link>
          <Link
            href="/mapping"
            className="block rounded px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 hover:text-slate-900"
          >
            Account Mapping
          </Link>
          <Link
            href="/validate"
            className="block rounded px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 hover:text-slate-900"
          >
            Validation
          </Link>
          <Link
            href="/settings"
            className="block rounded px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 hover:text-slate-900"
          >
            ⚙ Settings
          </Link>
        </div>
      </nav>
    </aside>
  );
}
