"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string };

const ITEMS: Item[] = [
  { href: "/data-prep/invoice-validation", label: "Invoice Validation" },
  { href: "/data-prep/pl-comparison", label: "P&L Comparison" },
  { href: "/data-prep/payroll", label: "Payroll" },
];

export default function DataPrepNav() {
  const pathname = usePathname();

  return (
    <>
      <div className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Data Preparation
      </div>
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
    </>
  );
}
