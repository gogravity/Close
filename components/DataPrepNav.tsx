"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Item = { href: string; label: string };

const ITEMS: Item[] = [
  { href: "/data-prep/invoice-validation", label: "Invoice Validation" },
  { href: "/data-prep/pl-comparison", label: "P&L Comparison" },
  { href: "/data-prep/payroll", label: "Payroll" },
];

export default function DataPrepNav() {
  const pathname = usePathname();
  const anyActive = ITEMS.some((i) => pathname.startsWith(i.href));
  // Open by default if the user is already on a Data-Prep route, otherwise
  // collapsed. Persist explicit user toggles so navigating between prep tabs
  // doesn't slam the menu shut.
  const [open, setOpen] = useState<boolean>(anyActive);

  useEffect(() => {
    if (anyActive) setOpen(true);
  }, [anyActive]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="mt-4 flex w-full items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
        aria-expanded={open}
      >
        <span className="text-[10px] text-slate-400">{open ? "▾" : "▸"}</span>
        Data Preparation
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {ITEMS.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded px-3 py-1.5 text-sm ${
                    isActive
                      ? "bg-slate-200 font-medium text-slate-900"
                      : "text-slate-700 hover:bg-slate-200 hover:text-slate-900"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
