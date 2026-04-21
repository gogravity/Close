"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type JeLine = { account: string; debit: number; credit: number };

type Props = {
  sectionSlug: string;
  period: string; // YYYY-MM
  memo: string;
  lines: JeLine[];
  initialConfirmed: boolean;
  confirmedAt?: string; // ISO timestamp
};

export default function JeConfirmButton({
  sectionSlug,
  period,
  memo,
  lines,
  initialConfirmed,
  confirmedAt,
}: Props) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(initialConfirmed);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setLoading(true);
    setError(null);
    try {
      if (confirmed) {
        // Unconfirm — remove from adjustments
        const res = await fetch(`/api/confirmed-jes/${sectionSlug}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ period }),
        });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        setConfirmed(false);
      } else {
        // Confirm — add JE to adjustments
        const res = await fetch(`/api/confirmed-jes/${sectionSlug}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ period, memo, lines }),
        });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        setConfirmed(true);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 flex items-center gap-3">
      <button
        onClick={toggle}
        disabled={loading}
        className={`flex items-center gap-2.5 rounded border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
          confirmed
            ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        {/* Checkbox icon */}
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
            confirmed
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-slate-400 bg-white"
          }`}
        >
          {confirmed && (
            <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none">
              <path
                d="M1.5 5.5L4 8L8.5 2.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        {loading ? "Saving…" : confirmed ? "JE confirmed — posted to adjustments" : "Confirm JE entered into BC"}
      </button>

      {confirmed && confirmedAt && (
        <span className="text-xs text-slate-400">
          {new Date(confirmedAt).toLocaleString()}
        </span>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
