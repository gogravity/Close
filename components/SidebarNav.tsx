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

  // Auto-open the section matching the current route.
  useEffect(() => {
    const match = sections.find((s) => pathname === `/section/${s.slug}`);
    if (match) setOpen((p) => ({ ...p, [match.slug]: true }));
  }, [pathname, sections]);

  return (
    <ul className="mt-1 space-y-0.5">
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
                className={`flex h-7 w-5 shrink-0 items-center justify-center rounded text-[10px] text-slate-400 hover:bg-slate-200 hover:text-slate-600 ${
                  hasChildren ? "" : "opacity-30 cursor-default"
                }`}
                aria-label={isOpen ? "Collapse" : "Expand"}
                disabled={!hasChildren}
              >
                {isOpen ? "▾" : "▸"}
              </button>
              <Link
                href={`/section/${s.slug}`}
                className={`flex-1 rounded px-2 py-1.5 text-sm ${
                  isActive && !activeAccount
                    ? "bg-slate-200 font-medium text-slate-900"
                    : "text-slate-700 hover:bg-slate-200 hover:text-slate-900"
                }`}
              >
                <span className="inline-block w-6 text-slate-400 tabular-nums">{s.order}.</span>
                {s.title}
              </Link>
            </div>
            {isOpen && hasChildren && (
              <ul className="ml-[26px] mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
                {s.subTabs.map((t) => {
                  const subActive = isActive && activeAccount === t.accountNumber;
                  return (
                    <li key={t.accountNumber}>
                      <Link
                        href={`/section/${s.slug}?account=${t.accountNumber}`}
                        className={`flex items-start gap-2 rounded px-2 py-1 text-xs ${
                          subActive
                            ? "bg-slate-200 font-medium text-slate-900"
                            : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                        }`}
                      >
                        <span className="font-mono text-[10px] text-slate-400 pt-0.5">
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
