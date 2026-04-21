"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string };

const ITEMS: Item[] = [
  { href: "/data-prep/invoice-validation", label: "Invoice Validation" },
  { href: "/data-prep/ar-cleanup", label: "AR Cleanup" },
  { href: "/data-prep/pl-comparison", label: "P&L Comparison" },
  { href: "/data-prep/payroll", label: "Payroll" },
];

export default function DataPrepNav() {
  const pathname = usePathname();

  return (
    <>
      <div className="pb-1 px-3 text-[9px] font-semibold uppercase tracking-widest text-slate-500">
        Data Preparation
      </div>
      <ul className="space-y-0.5">
        {ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`block rounded py-1.5 pl-6 pr-3 text-sm transition-colors ${
                  isActive
                    ? "bg-white/10 text-white font-medium"
                    : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
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
