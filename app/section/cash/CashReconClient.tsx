"use client";

import { useMemo, useState } from "react";
import { fmt } from "@/lib/recon";

export type ReconAccount = {
  bcAccountNumber: string;
  bcDisplayName: string;
  unadjustedGL: number;
  input: {
    accountDisplayName?: string;
    bankAcctLast4?: string;
    statementBalance: number | null;
    depositsInTransit: number | null;
    outstandingChecks: number | null;
    miscAdjustmentAccount?: string;
    notes?: string;
  };
};

type Props = {
  periodEnd: string;
  accounts: ReconAccount[];
};

type InputPatch = ReconAccount["input"];

function calcRecon(a: ReconAccount, input: InputPatch) {
  const dit = input.depositsInTransit ?? 0;
  const oc = input.outstandingChecks ?? 0;
  const stmt = input.statementBalance;
  const adjustedBank = stmt === null ? null : stmt + dit - oc;
  const variance = adjustedBank === null ? null : a.unadjustedGL - adjustedBank;
  const reconciled = variance !== null && Math.abs(variance) < 0.01;
  const materialVariance = variance !== null && Math.abs(variance) >= 0.01;
  return { dit, oc, stmt, adjustedBank, variance, reconciled, materialVariance };
}

function num(v: string): number | null {
  if (v === "" || v === "-") return null;
  const parsed = Number(v.replace(/,/g, ""));
  return isFinite(parsed) ? parsed : null;
}

type PdfUploadState = {
  status: "idle" | "uploading" | "parsing" | "done" | "error";
  error?: string;
  extraction?: {
    endingBalance: number | null;
    asOfDate: string | null;
    accountNumberLast4: string | null;
    bankName: string | null;
    outstandingChecks: { checkNumber: string; date: string | null; amount: number }[];
    depositsInTransit: { date: string | null; amount: number; description?: string }[];
    notes: string;
    confidence: "high" | "medium" | "low";
  };
  scrubReport?: {
    redactions: Record<string, number>;
    preservedAccountLast4: string[];
    pagesExtracted: number;
    charactersSent: number;
  };
  pdfUrl?: string;
};

export default function CashReconClient({ periodEnd, accounts }: Props) {
  const [active, setActive] = useState(accounts[0]?.bcAccountNumber ?? "");
  const [drafts, setDrafts] = useState<Record<string, InputPatch>>(() => {
    const out: Record<string, InputPatch> = {};
    for (const a of accounts) out[a.bcAccountNumber] = { ...a.input };
    return out;
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Record<string, PdfUploadState>>({});

  const activeAccount = accounts.find((a) => a.bcAccountNumber === active) ?? accounts[0];
  const draft = drafts[active] ?? activeAccount?.input ?? { statementBalance: null, depositsInTransit: null, outstandingChecks: null };
  const computed = activeAccount ? calcRecon(activeAccount, draft) : null;

  async function save() {
    if (!activeAccount) return;
    setSaving(true);
    try {
      const res = await fetch("/api/recon/cash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bcAccountNumber: activeAccount.bcAccountNumber,
          input: draft,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setSavedAt((p) => ({ ...p, [active]: new Date().toLocaleTimeString() }));
    } finally {
      setSaving(false);
    }
  }

  function patch(p: Partial<InputPatch>) {
    setDrafts((prev) => ({ ...prev, [active]: { ...prev[active], ...p } as InputPatch }));
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
        No BC accounts are mapped to the Cash section. Go to{" "}
        <a className="text-blue-600 hover:underline" href="/mapping">
          Account Mapping
        </a>{" "}
        and assign each bank/cash account to the Cash section.
      </div>
    );
  }

  const perAccountSummary = useMemo(
    () =>
      accounts.map((a) => {
        const d = drafts[a.bcAccountNumber] ?? a.input;
        const c = calcRecon(a, d);
        return { ...a, ...c };
      }),
    [accounts, drafts]
  );

  return (
    <div>
      {/* Tab strip */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {perAccountSummary.map((a) => {
          const isActive = a.bcAccountNumber === active;
          const done = a.reconciled;
          const stale = a.stmt === null;
          return (
            <button
              key={a.bcAccountNumber}
              type="button"
              onClick={() => setActive(a.bcAccountNumber)}
              className={`relative rounded-t border-t border-x px-4 py-2 text-sm ${
                isActive
                  ? "border-slate-300 bg-white text-slate-900 font-medium -mb-px"
                  : "border-transparent text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className="mr-2 align-middle inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: done ? "#10b981" : stale ? "#94a3b8" : "#f59e0b" }} />
              <span className="font-mono text-xs text-slate-500 mr-2">{a.bcAccountNumber}</span>
              {a.bcDisplayName}
            </button>
          );
        })}
      </div>

      {activeAccount && computed && (
        <div className="space-y-6">
          {/* Header strip per Excel layout */}
          <div className="rounded border border-slate-200 bg-white">
            <div className="grid grid-cols-4 divide-x divide-slate-200">
              <HeaderCell label="GL Account" value={activeAccount.bcDisplayName} />
              <HeaderCell
                label="Account Name"
                value={
                  <input
                    value={draft.accountDisplayName ?? ""}
                    onChange={(e) => patch({ accountDisplayName: e.target.value })}
                    placeholder="e.g. US Bank Platinum Business Checking"
                    className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
                  />
                }
              />
              <HeaderCell
                label="Bank Acct (last 4)"
                value={
                  <input
                    value={draft.bankAcctLast4 ?? ""}
                    onChange={(e) => patch({ bankAcctLast4: e.target.value })}
                    placeholder="5047"
                    className="w-full rounded border border-slate-200 px-2 py-1 text-sm font-mono"
                  />
                }
              />
              <HeaderCell label="Period End" value={periodEnd} />
            </div>
          </div>

          {/* PDF upload + extraction */}
          <StatementUpload
            bcAccountNumber={activeAccount.bcAccountNumber}
            state={uploads[active]}
            onUpload={async (file) => {
              setUploads((p) => ({ ...p, [active]: { status: "uploading" } }));
              const body = new FormData();
              body.append("file", file);
              body.append("bcAccountNumber", activeAccount.bcAccountNumber);
              try {
                setUploads((p) => ({ ...p, [active]: { status: "parsing" } }));
                const res = await fetch("/api/recon/cash/parse-pdf", {
                  method: "POST",
                  body,
                });
                const json = await res.json();
                if (!json.ok) {
                  setUploads((p) => ({
                    ...p,
                    [active]: { status: "error", error: json.error ?? "Upload failed" },
                  }));
                  return;
                }
                setUploads((p) => ({
                  ...p,
                  [active]: {
                    status: "done",
                    extraction: json.extraction,
                    scrubReport: json.scrubReport,
                    pdfUrl: json.pdfUrl,
                  },
                }));
              } catch (err) {
                setUploads((p) => ({
                  ...p,
                  [active]: { status: "error", error: (err as Error).message },
                }));
              }
            }}
            onApply={(ex) => {
              const outstandingTotal = ex.outstandingChecks.reduce((s, c) => s + c.amount, 0);
              const ditTotal = ex.depositsInTransit.reduce((s, d) => s + d.amount, 0);
              patch({
                statementBalance: ex.endingBalance,
                outstandingChecks: outstandingTotal > 0 ? outstandingTotal : draft.outstandingChecks,
                depositsInTransit: ditTotal > 0 ? ditTotal : draft.depositsInTransit,
                bankAcctLast4: ex.accountNumberLast4 ?? draft.bankAcctLast4,
              });
            }}
          />

          {/* Reconciliation block */}
          <div className="rounded border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
              Account Reconciliation — {activeAccount.bcDisplayName}
            </div>
            <div className="divide-y divide-slate-100">
              <ReconRow
                label="Balance Per Bank (statement ending balance)"
                editable
                value={draft.statementBalance}
                onChange={(v) => patch({ statementBalance: v })}
                required
              />
              <ReconRow
                label="Deposits in Transit (+)"
                editable
                value={draft.depositsInTransit}
                onChange={(v) => patch({ depositsInTransit: v })}
              />
              <ReconRow
                label="Outstanding Checks (−)"
                editable
                value={draft.outstandingChecks}
                onChange={(v) => patch({ outstandingChecks: v })}
              />
              <ReconRow
                label="Adjusted Balance per Bank"
                value={computed.adjustedBank}
                emphasis
              />
              <ReconRow
                label="Unadjusted Balance per GL (BC)"
                value={activeAccount.unadjustedGL}
              />
              <ReconRow
                label="Variance (GL − Adjusted Bank)"
                value={computed.variance}
                tone={computed.reconciled ? "ok" : computed.materialVariance ? "warn" : "neutral"}
                emphasis
              />
            </div>
          </div>

          {/* Journal entry (if needed) */}
          {computed.materialVariance && computed.variance !== null ? (
            <div className="rounded border border-amber-200 bg-amber-50/40">
              <div className="border-b border-amber-200 px-4 py-2 text-sm font-semibold text-amber-900">
                Adjusting Journal Entry
              </div>
              <div className="px-4 py-3 space-y-2 text-sm text-slate-900">
                <div className="text-xs text-amber-800">
                  {computed.variance > 0
                    ? `GL is overstated by ${fmt(Math.abs(computed.variance))}. Write down to match the bank.`
                    : `GL is understated by ${fmt(Math.abs(computed.variance))}. Write up to match the bank.`}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-slate-500">Misc offset account:</span>
                  <input
                    value={draft.miscAdjustmentAccount ?? ""}
                    onChange={(e) => patch({ miscAdjustmentAccount: e.target.value })}
                    placeholder="Miscellaneous Expense"
                    className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
                <table className="mt-2 w-full text-sm">
                  <thead className="text-slate-600">
                    <tr>
                      <th className="text-left font-medium py-1">Account</th>
                      <th className="text-right font-medium py-1 w-[130px]">Debit</th>
                      <th className="text-right font-medium py-1 w-[130px]">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="border-t border-amber-200">
                    {computed.variance > 0 ? (
                      <>
                        <tr>
                          <td className="py-1">{draft.miscAdjustmentAccount || "Miscellaneous Expense"}</td>
                          <td className="py-1 text-right tabular-nums">{fmt(Math.abs(computed.variance))}</td>
                          <td className="py-1 text-right">—</td>
                        </tr>
                        <tr>
                          <td className="py-1">{activeAccount.bcDisplayName}</td>
                          <td className="py-1 text-right">—</td>
                          <td className="py-1 text-right tabular-nums">{fmt(Math.abs(computed.variance))}</td>
                        </tr>
                      </>
                    ) : (
                      <>
                        <tr>
                          <td className="py-1">{activeAccount.bcDisplayName}</td>
                          <td className="py-1 text-right tabular-nums">{fmt(Math.abs(computed.variance))}</td>
                          <td className="py-1 text-right">—</td>
                        </tr>
                        <tr>
                          <td className="py-1">{draft.miscAdjustmentAccount || "Miscellaneous Expense"}</td>
                          <td className="py-1 text-right">—</td>
                          <td className="py-1 text-right tabular-nums">{fmt(Math.abs(computed.variance))}</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : draft.statementBalance !== null && computed.reconciled ? (
            <div className="rounded border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm text-emerald-900">
              ✓ Reconciled — bank and GL match exactly. No adjusting journal entry required.
            </div>
          ) : (
            <div className="rounded border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
              Enter the statement balance above to compute the reconciliation.
            </div>
          )}

          {/* Save */}
          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <div className="text-xs text-slate-500">
              {savedAt[active] ? `Saved ${savedAt[active]}` : "Unsaved changes"}
            </div>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatementUpload({
  bcAccountNumber,
  state,
  onUpload,
  onApply,
}: {
  bcAccountNumber: string;
  state?: PdfUploadState;
  onUpload: (file: File) => Promise<void>;
  onApply: (ex: NonNullable<PdfUploadState["extraction"]>) => void;
}) {
  const busy = state?.status === "uploading" || state?.status === "parsing";
  const ex = state?.extraction;
  return (
    <div className="rounded border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">Upload statement PDF</div>
          <div className="text-xs text-slate-500">
            Text is extracted on this host, PII is scrubbed, then only the scrubbed text is
            sent to the AI. The PDF itself never leaves this machine.
          </div>
        </div>
        <label className="cursor-pointer rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          {busy ? "Processing…" : "Choose PDF"}
          <input
            key={bcAccountNumber + (state?.status ?? "idle")}
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
        </label>
      </div>
      {state?.status === "error" && (
        <div className="px-4 py-3 text-sm text-red-700 bg-red-50 border-b border-red-200">
          {state.error}
        </div>
      )}
      {ex && (
        <div className="grid grid-cols-[1fr_1fr] gap-0 divide-x divide-slate-200">
          <div className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Extracted
              </div>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  ex.confidence === "high"
                    ? "bg-emerald-100 text-emerald-800"
                    : ex.confidence === "medium"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {ex.confidence} confidence
              </span>
            </div>
            <dl className="space-y-1 text-sm">
              <Row label="Bank" value={ex.bankName ?? "—"} />
              <Row label="Account (last 4)" value={ex.accountNumberLast4 ?? "—"} mono />
              <Row
                label="Ending balance"
                value={ex.endingBalance !== null ? fmt(ex.endingBalance) : "—"}
                emphasis
              />
              <Row label="As of" value={ex.asOfDate ?? "—"} />
              <Row
                label="Outstanding checks"
                value={
                  ex.outstandingChecks.length === 0
                    ? "none listed"
                    : `${ex.outstandingChecks.length} item(s) · ${fmt(ex.outstandingChecks.reduce((s, c) => s + c.amount, 0))}`
                }
              />
              <Row
                label="Deposits in transit"
                value={
                  ex.depositsInTransit.length === 0
                    ? "none listed"
                    : `${ex.depositsInTransit.length} item(s) · ${fmt(ex.depositsInTransit.reduce((s, d) => s + d.amount, 0))}`
                }
              />
            </dl>
            {ex.notes && (
              <div className="mt-3 rounded bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                {ex.notes}
              </div>
            )}
            {state?.scrubReport && (
              <details className="mt-3 text-[11px] text-slate-500">
                <summary className="cursor-pointer">Scrubber report</summary>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(state.scrubReport.redactions).map(([k, n]) => (
                    <li key={k}>
                      {k}: {n} redacted
                    </li>
                  ))}
                  <li>pages: {state.scrubReport.pagesExtracted}</li>
                  <li>characters sent: {state.scrubReport.charactersSent}</li>
                </ul>
              </details>
            )}
            <button
              type="button"
              onClick={() => onApply(ex)}
              className="mt-4 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Apply to rec below
            </button>
          </div>
          <div className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Statement preview (local only)
            </div>
            {state?.pdfUrl ? (
              <iframe
                src={state.pdfUrl}
                className="h-[420px] w-full rounded border border-slate-200"
                title="Uploaded statement"
              />
            ) : (
              <div className="h-[420px] rounded border border-dashed border-slate-200 grid place-items-center text-xs text-slate-400">
                PDF preview unavailable
              </div>
            )}
          </div>
        </div>
      )}
      {state?.status === "parsing" && !ex && (
        <div className="px-4 py-6 text-center text-sm text-slate-500">
          Scrubbing + asking Claude…
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd
        className={`${mono ? "font-mono" : ""} ${
          emphasis ? "text-lg font-semibold tabular-nums" : "text-sm"
        } text-slate-900`}
      >
        {value}
      </dd>
    </div>
  );
}

function HeaderCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-900">{value}</div>
    </div>
  );
}

function ReconRow({
  label,
  value,
  editable,
  onChange,
  emphasis,
  tone = "neutral",
  required,
}: {
  label: string;
  value: number | null | undefined;
  editable?: boolean;
  onChange?: (v: number | null) => void;
  emphasis?: boolean;
  tone?: "neutral" | "ok" | "warn";
  required?: boolean;
}) {
  const toneClass =
    tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-slate-900";
  return (
    <div
      className={`flex items-center justify-between px-4 py-2 ${emphasis ? "bg-slate-50 font-semibold" : ""}`}
    >
      <div className="text-sm text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </div>
      {editable && onChange ? (
        <input
          inputMode="decimal"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(num(e.target.value))}
          placeholder="0.00"
          className="w-[160px] rounded border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
        />
      ) : (
        <span className={`tabular-nums text-sm ${toneClass}`}>
          {value === null || value === undefined ? "—" : fmt(value)}
        </span>
      )}
    </div>
  );
}
