import Link from "next/link";
import { Suspense } from "react";
import { headers } from "next/headers";
import { sections } from "@/lib/recon";
import { getEntityConfig, getAccountMappings } from "@/lib/settings";
import { listAccounts, BusinessCentralError } from "@/lib/businessCentral";
import SidebarNav, { type SidebarSection } from "./SidebarNav";
import DataPrepNav from "./DataPrepNav";

export default async function Sidebar() {
  const { name, periodEnd } = await getEntityConfig();

  const h = await headers();
  const signedInAs =
    h.get("x-ms-client-principal-name") ??
    h.get("x-ms-client-principal-idp-upn") ??
    null;

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
      if (!s.showAccountSubTabs) {
        return { slug: s.slug, title: s.title, order: s.order, subTabs: [] };
      }
      const subAccounts = Object.entries(mappings)
        .filter(([, slug]) => slug === s.slug)
        .map(([num]) => byNumber.get(num))
        .filter((a): a is NonNullable<typeof a> => Boolean(a))
        .sort((a, b) => {
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
    <aside className="w-64 shrink-0 flex flex-col bg-slate-950 overflow-y-auto">
      {/* Branding */}
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">
          Monthly Close
        </div>
        <div className="mt-1 font-semibold text-white leading-tight">
          {name || "Unconfigured entity"}
        </div>
        <div className="mt-0.5 text-xs text-slate-400">
          {periodEnd ? `Period ending ${periodEnd}` : "Set period in Settings"}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <DataPrepNav />

        <Link
          href="/"
          className="block rounded px-3 py-1.5 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors mt-4"
        >
          Balance Sheet Summary
        </Link>

        <div className="pt-5 pb-1 px-3 text-[9px] font-semibold uppercase tracking-widest text-slate-500">
          Balance Sheet Reconciliation
        </div>
        <Suspense fallback={<ul className="mt-1 space-y-0.5" />}>
          <SidebarNav sections={navSections} />
        </Suspense>

        <div className="pt-5 pb-1 px-3 text-[9px] font-semibold uppercase tracking-widest text-slate-500">
          MRR Bridge
        </div>
        <Link
          href="/mrr-bridge"
          className="block rounded px-3 py-1.5 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors"
        >
          Monthly Bridge
        </Link>
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-slate-800">
        <Link
          href="/settings"
          className="block rounded px-3 py-1.5 text-sm text-slate-400 hover:bg-white/[0.06] hover:text-white transition-colors"
        >
          ⚙ Settings
        </Link>
        {signedInAs && (
          <div className="mt-2 px-3 truncate text-[10px] text-slate-600" title={signedInAs}>
            {signedInAs}
          </div>
        )}
        <a
          href="/.auth/logout?post_logout_redirect_uri=/"
          className="block rounded px-3 py-1 text-xs text-slate-600 hover:text-slate-400 transition-colors"
        >
          Sign out
        </a>
      </div>
    </aside>
  );
}
