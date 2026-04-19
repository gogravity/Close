"use client";

import { useState } from "react";
import { fmt } from "@/lib/recon";

export type Candidate = {
  entryNumber: number;
  postingDate: string;
  documentNumber: string;
  description: string;
  amount: number;
  isTravel: boolean;
  reason: "travel" | "one-off-large";
  accountNumber: string;
  accountName: string;
  isRecurring: boolean;
  recurringMonthCount: number;
};


type RecognitionDraft = {
  months: number | null;
  beginDate: string;  // yyyy-mm-dd or ""
  endDate: string;    // yyyy-mm-dd or ""
};

type Recognition = {
  months: number;
  beginDate: string;
  endDate: string;
};

function isComplete(d: RecognitionDraft): d is Recognition {
  return d.months != null && d.months > 0 && !!d.beginDate && !!d.endDate;
}

function addMonths(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function endOfMonth(dateStr: string): string {
  const d = new Date(dateStr);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return next.toISOString().slice(0, 10);
}

function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

function defaultRecognition(c: Candidate): Recognition {
  // Travel → 1 month, begin & end date default to the month the charge
  // posted (user will typically adjust to match actual trip dates).
  // Non-travel (annual subscriptions, insurance) → 12 months starting the
  // posting month, ending 11 months later.
  const posting = c.postingDate.slice(0, 10);
  if (c.isTravel) {
    return {
      months: 1,
      beginDate: startOfMonth(posting),
      endDate: endOfMonth(posting),
    };
  }
  const beginDate = startOfMonth(posting);
  return {
    months: 12,
    beginDate,
    endDate: endOfMonth(addMonths(beginDate, 11)),
  };
}

export default function CandidateRow({
  c,
  initialRecognition,
}: {
  c: Candidate;
  initialRecognition?: Recognition;
}) {
  const [savingDecision, setSavingDecision] = useState(false);
  const [draft, setDraft] = useState<RecognitionDraft>(
    initialRecognition ?? { months: null, beginDate: "", endDate: "" }
  );

  const complete = isComplete(draft);

  async function persist(next: RecognitionDraft) {
    setSavingDecision(true);
    try {
      await fetch("/api/prepaids/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryNumber: c.entryNumber,
          confirmed: isComplete(next),
          recognition: isComplete(next) ? next : undefined,
        }),
      });
    } finally {
      setSavingDecision(false);
    }
  }

  function updateField(patch: Partial<RecognitionDraft>) {
    const next = { ...draft, ...patch };
    // Smart defaults: if months + beginDate are now both set and endDate is
    // blank, auto-fill endDate to (begin + months - 1, end of that month).
    if (
      next.months &&
      next.months > 0 &&
      next.beginDate &&
      !next.endDate &&
      patch.endDate === undefined
    ) {
      const d = new Date(next.beginDate);
      d.setUTCMonth(d.getUTCMonth() + (next.months - 1));
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      next.endDate = end.toISOString().slice(0, 10);
    }
    setDraft(next);
    void persist(next);
  }

  return (
    <>
      <tr
        className={`border-t border-slate-100 ${
          complete ? "bg-emerald-50/50" : ""
        }`}
      >
        <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">
          {c.postingDate.slice(0, 10)}
        </td>
        <td className="px-3 py-1.5">
          {c.isTravel && (
            <span className="mr-1 text-blue-600" title="Travel account">
              ✈
            </span>
          )}
          <span
            className="truncate inline-block max-w-[300px] align-middle"
            title={c.description}
          >
            {c.description}
          </span>{" "}
          {/^RMP/i.test(c.documentNumber) ? (
            <a
              href={`/api/prepaids/rmp-receipt?amount=${c.amount.toFixed(
                2
              )}&date=${c.postingDate.slice(0, 10)}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] text-blue-600 hover:underline"
              title="Open Ramp receipt PDF in new tab"
            >
              {c.documentNumber}
            </a>
          ) : (
            <span className="font-mono text-[10px] text-slate-400">
              {c.documentNumber}
            </span>
          )}
        </td>
        <td className="px-3 py-1.5 text-xs text-slate-600">
          <span className="font-mono text-[11px] text-slate-500 mr-1">{c.accountNumber}</span>
          {c.accountName}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmt(c.amount)}</td>
        <td className="px-3 py-1.5">
          {c.reason === "travel" ? (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-800">
              Travel
            </span>
          ) : (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
              One-off
            </span>
          )}
        </td>
        <td className="px-2 py-1.5 w-[70px]">
          <input
            type="number"
            min={1}
            max={60}
            value={draft.months ?? ""}
            placeholder="—"
            onChange={(e) =>
              updateField({
                months: e.target.value === "" ? null : Math.max(1, Number(e.target.value)),
              })
            }
            className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-right text-xs tabular-nums"
            aria-label="# of months"
          />
        </td>
        <td className="px-2 py-1.5 w-[130px]">
          <input
            type="date"
            value={draft.beginDate}
            onChange={(e) => updateField({ beginDate: e.target.value })}
            className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-xs"
            aria-label="Begin date"
          />
        </td>
        <td className="px-2 py-1.5 w-[130px]">
          <input
            type="date"
            value={draft.endDate}
            onChange={(e) => updateField({ endDate: e.target.value })}
            className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-xs"
            aria-label="End date"
          />
        </td>
        <td className="px-3 py-1.5 w-[50px] text-right">
          {savingDecision && (
            <span className="text-[10px] text-slate-400">saving…</span>
          )}
        </td>
      </tr>
    </>
  );
}

