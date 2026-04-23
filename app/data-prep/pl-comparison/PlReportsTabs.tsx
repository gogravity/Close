"use client";

import { useState } from "react";
import PlComparisonClient from "./PlComparisonClient";
import PlBySubaccountClient from "./PlBySubaccountClient";

type Tab = "comparison" | "subaccount";

export default function PlReportsTabs({ defaultEndMonth }: { defaultEndMonth: string }) {
  const [tab, setTab] = useState<Tab>("comparison");

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-1 border-b border-slate-200">
        <TabButton active={tab === "comparison"} onClick={() => setTab("comparison")}>
          Monthly Comparison
        </TabButton>
        <TabButton active={tab === "subaccount"} onClick={() => setTab("subaccount")}>
          By Subaccount / Department
        </TabButton>
      </nav>

      {tab === "comparison" && <PlComparisonClient defaultEndMonth={defaultEndMonth} />}
      {tab === "subaccount" && <PlBySubaccountClient defaultEndMonth={defaultEndMonth} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative rounded-t border-t border-x px-4 py-2 text-sm ${
        active
          ? "border-slate-300 bg-white text-slate-900 font-medium -mb-px"
          : "border-transparent text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
