"use client";

import { useState } from "react";
import { fmt } from "@/lib/recon";

export type TaxAccount = {
  bcAccountNumber: string;
  bcDisplayName: string;
  glBalance: number;           // negative (liability)
  initial: {
    filedLiability: number | null;
    adjustment: number | null;
    notes?: string;
  };
};

type Props = {
  periodEnd: string;
  accounts: TaxAccount[];
  offsetAccount: { number: string; displayName: string } | null;
};

export default function TaxReconClient({
  periodEnd,
  accounts,
  offsetAccount,
}: Props) {
  return (
    <div className="space-y-6">
      {accounts.map((a) => (
        <AccountCard
          key={a.bcAccountNumber}
          periodEnd={periodEnd}
          account={a}
          offsetAccount={offsetAccount}
        />
      ))}
    </div>
  );
}

function AccountCard({
  periodEnd,
  account,
  offsetAccount,
}: {
  periodEnd: string;
  account: TaxAccount;
  offsetAccount: { number: string; displayName: string } | null;
}) {
  const [filedLiability, setFiledLiability] = useState<number | null>(
    account.initial.filedLiability
  );
  const [adjustment, setAdjustment] = useState<number | null>(
    account.initial.adjustment
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // GL liability is negative; flip for comparison.
  const glPayable = -account.glBalance;
  const expectedGl =
    filedLiability === null
      ? null
      : filedLiability + (adjustment ?? 0);
  // Difference = Expected GL − BC GL. Should be 0 / immaterial when Adjustment
  // captures the known timing/rounding explanation.
  const variance = expectedGl === null ? null : expectedGl - glPayable;
  const material = variance !== null && Math.abs(variance) >= 0.01;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/recon/tax", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bcAccountNumber: account.bcAccountNumber,
          input: { filedLiability, adjustment },
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setSavedAt(new Date().toLocaleTimeString());
    } finally {
      setSaving(false);
    }
  }

  function parseNum(v: string): number | null {
    if (v === "") return null;
    const n = Number(v.replace(/,/g, ""));
    return isFinite(n) ? n : null;
  }

  return (
    <div className="rounded border border-slate-200 bg-white">
      <header className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              <span className="font-mono text-xs text-slate-500 mr-2">
                {account.bcAccountNumber}
              </span>
              {account.bcDisplayName}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              Period ending {periodEnd}
            </div>
          </div>
        </div>
      </header>

      <div className="divide-y divide-slate-100">
        <EditableRow
          label="Total Sales Tax Payable (per compliance report)"
          value={filedLiability}
          onChange={setFiledLiability}
          onParse={parseNum}
          required
        />
        <EditableRow
          label="Adjustment made"
          value={adjustment}
          onChange={setAdjustment}
          onParse={parseNum}
        />
        <Row
          label="Expected GL balance (Filed + Adjustment)"
          value={expectedGl}
          emphasis
        />
        <Row label="Balance as per BC" value={glPayable} />
        <Row
          label="Difference"
          value={variance}
          emphasis
          tone={
            variance === null ? "neutral" : material ? "warn" : "ok"
          }
        />
      </div>

      {material && variance !== null ? (
        <div className="border-t border-amber-200 bg-amber-50/40 px-4 py-3 text-sm">
          <div className="text-xs text-amber-800 mb-2">
            {variance > 0
              ? `GL is understated by ${fmt(Math.abs(variance))} — book additional tax liability.`
              : `GL is overstated by ${fmt(Math.abs(variance))} — reverse excess liability.`}
          </div>
          <table className="w-full text-sm">
            <thead className="text-slate-600">
              <tr>
                <th className="py-1 text-left font-medium w-[80px]">BC #</th>
                <th className="py-1 text-left font-medium">Account</th>
                <th className="py-1 text-right font-medium w-[130px]">Debit</th>
                <th className="py-1 text-right font-medium w-[130px]">Credit</th>
              </tr>
            </thead>
            <tbody className="border-t border-amber-200">
              {variance > 0 ? (
                <>
                  <tr>
                    <td className="py-1 font-mono text-[11px] text-slate-500">
                      {offsetAccount?.number ?? "—"}
                    </td>
                    <td className="py-1">
                      {offsetAccount?.displayName ?? (
                        <span className="italic text-slate-400">Sales Tax Expense (unassigned)</span>
                      )}
                    </td>
                    <td className="py-1 text-right tabular-nums">{fmt(Math.abs(variance))}</td>
                    <td className="py-1 text-right">—</td>
                  </tr>
                  <tr>
                    <td className="py-1 font-mono text-[11px] text-slate-500">
                      {account.bcAccountNumber}
                    </td>
                    <td className="py-1">{account.bcDisplayName}</td>
                    <td className="py-1 text-right">—</td>
                    <td className="py-1 text-right tabular-nums">{fmt(Math.abs(variance))}</td>
                  </tr>
                </>
              ) : (
                <>
                  <tr>
                    <td className="py-1 font-mono text-[11px] text-slate-500">
                      {account.bcAccountNumber}
                    </td>
                    <td className="py-1">{account.bcDisplayName}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(Math.abs(variance))}</td>
                    <td className="py-1 text-right">—</td>
                  </tr>
                  <tr>
                    <td className="py-1 font-mono text-[11px] text-slate-500">
                      {offsetAccount?.number ?? "—"}
                    </td>
                    <td className="py-1">
                      {offsetAccount?.displayName ?? (
                        <span className="italic text-slate-400">Sales Tax Expense (unassigned)</span>
                      )}
                    </td>
                    <td className="py-1 text-right">—</td>
                    <td className="py-1 text-right tabular-nums">{fmt(Math.abs(variance))}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      ) : filedLiability !== null ? (
        <div className="border-t border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm text-emerald-900">
          ✓ Filed liability ties to GL. No adjusting JE required.
        </div>
      ) : (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          Enter the filed liability from the compliance-filing report to
          compute the variance.
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2">
        <div className="text-xs text-slate-500">
          {savedAt ? `Saved ${savedAt}` : "Unsaved"}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
  tone = "neutral",
}: {
  label: string;
  value: number | null | undefined;
  emphasis?: boolean;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
      ? "text-amber-700"
      : "text-slate-900";
  return (
    <div
      className={`flex items-center justify-between px-4 py-2 ${
        emphasis ? "bg-slate-50 font-semibold" : ""
      }`}
    >
      <div className="text-sm text-slate-700">{label}</div>
      <span className={`tabular-nums text-sm ${toneClass}`}>
        {value === null || value === undefined ? "—" : fmt(value)}
      </span>
    </div>
  );
}

function EditableRow({
  label,
  value,
  onChange,
  onParse,
  required,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  onParse: (v: string) => number | null;
  required?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <div className="text-sm text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </div>
      <input
        inputMode="decimal"
        value={value === null ? "" : String(value)}
        onChange={(e) => onChange(onParse(e.target.value))}
        placeholder="0.00"
        className="w-[160px] rounded border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
      />
    </div>
  );
}
