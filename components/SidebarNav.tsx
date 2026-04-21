"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export type SidebarSubTab = {
  accountNumber: string;
  accountName: string;
};

export type SidebarSection = {
  slug: string;
  title: string;
  order: number;
  subTabs: SidebarSubTab[];
};

type Props = {
  sections: SidebarSection[];
};

export default function SidebarNav({ sections }: Props) {
  const pathname = usePathname();
  const search = useSearchParams();
  const activeAccount = search.get("account");

  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const match = sections.find((s) => pathname === `/section/${s.slug}`);
    if (match) setOpen((p) => ({ ...p, [match.slug]: true }));
  }, [pathname, sections]);

  return (
    <ul className="space-y-0.5">
      {sections.map((s) => {
        const isActive = pathname === `/section/${s.slug}`;
        const isOpen = open[s.slug] ?? false;
        const hasChildren = s.subTabs.length > 0;
        return (
          <li key={s.slug}>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setOpen((p) => ({ ...p, [s.slug]: !isOpen }))}
                className={`flex h-7 w-5 shrink-0 items-center justify-center rounded text-[10px] text-slate-600 hover:text-slate-300 transition-colors ${
                  hasChildren ? "" : "opacity-0 pointer-events-none"
                }`}
                aria-label={isOpen ? "Collapse" : "Expand"}
                disabled={!hasChildren}
              >
                {isOpen ? "▾" : "▸"}
              </button>
              <Link
                href={`/section/${s.slug}`}
                className={`flex-1 rounded px-2 py-1.5 text-sm transition-colors ${
                  isActive && !activeAccount
                    ? "bg-white/10 font-medium text-white"
                    : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <span className="inline-block w-5 text-slate-600 tabular-nums text-xs">{s.order}.</span>
                {s.title}
              </Link>
            </div>
            {isOpen && hasChildren && (
              <ul className="ml-[26px] mt-0.5 space-y-0.5 border-l border-slate-800 pl-2">
                {s.subTabs.map((t) => {
                  const subActive = isActive && activeAccount === t.accountNumber;
                  return (
                    <li key={t.accountNumber}>
                      <Link
                        href={`/section/${s.slug}?account=${t.accountNumber}`}
                        className={`flex items-start gap-2 rounded px-2 py-1 text-xs transition-colors ${
                          subActive
                            ? "bg-white/10 font-medium text-white"
                            : "text-slate-400 hover:bg-white/[0.06] hover:text-white"
                        }`}
                      >
                        <span className="font-mono text-[10px] text-slate-600 pt-0.5">
                          {t.accountNumber}
                        </span>
                        <span className="flex-1 truncate">{t.accountName}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
