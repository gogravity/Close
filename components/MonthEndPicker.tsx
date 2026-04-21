"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  initialPeriod?: string; // YYYY-MM-DD
};

function toMonthValue(dateStr?: string): string {
  if (!dateStr) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  return dateStr.slice(0, 7); // "YYYY-MM"
}

function lastDayOfMonth(monthValue: string): string {
  const [year, month] = monthValue.split("-").map(Number);
  const last = new Date(year, month, 0); // day 0 of next month = last day of this month
  return `${year}-${String(month).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

export default function MonthEndPicker({ initialPeriod }: Props) {
  const router = useRouter();
  const [month, setMonth] = useState(toMonthValue(initialPeriod));
  const [loading, setLoading] = useState(false);

  async function handleSync() {
    setLoading(true);
    try {
      const periodEnd = lastDayOfMonth(month);
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodEnd }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500 whitespace-nowrap">
          Month End
        </label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
        />
      </div>
      <button
        onClick={handleSync}
        disabled={loading}
        className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-700 disabled:opacity-50"
      >
        {loading ? "Syncing…" : "Sync Data"}
      </button>
    </div>
  );
}
