"use client";

import { useMemo, useState } from "react";
import { sections } from "@/lib/recon";

type Account = {
  id: string;
  number: string;
  displayName: string;
  category: string;
  subCategory: string;
  balance: number;
  mappedTo: string | null;
};

type Props = { initial: { periodEnd: string; accounts: Account[] } };

// Maps BC sub-category → suggested section slug. Anything unlisted is suggested
// as null (unmapped/excluded).
const SUBCATEGORY_HINTS: Record<string, string> = {
  Cash: "cash",
  "Accounts Receivable": "accounts-receivable",
  Inventory: "inventory",
  "Accounts Payable": "accounts-payable",
  "Customer Prepayments": "customer-prepayments",
  "Credit Card": "credit-cards",
  "Credit Cards": "credit-cards",
  "Sales Tax": "tax-liabilities",
  Payroll: "payroll-liabilities",
  "Accrued Expenses": "accrued-expenses",
  "Deferred Revenue": "deferred-revenue",
};

function suggestSection(a: Account): string | null {
  return SUBCATEGORY_HINTS[a.subCategory] ?? null;
}

function fmt(n: number): string {
  if (n === 0) return "–";
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `($${s})` : `$${s}`;
}

export default function MappingEditor({ initial }: Props) {
  const [accounts, setAccounts] = useState(initial.accounts);
  const [filter, setFilter] = useState<"all" | "unmapped" | "mapped">("unmapped");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, string | null>>({});

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (filter === "unmapped" && a.mappedTo !== null) return false;
      if (filter === "mapped" && a.mappedTo === null) return false;
      if (!q) return true;
      return (
        a.number.toLowerCase().includes(q) ||
        a.displayName.toLowerCase().includes(q) ||
        a.subCategory.toLowerCase().includes(q)
      );
    });
  }, [accounts, filter, search]);

  const counts = useMemo(() => {
    let mapped = 0;
    let unmapped = 0;
    for (const a of accounts) (a.mappedTo ? mapped++ : unmapped++);
    return { mapped, unmapped, total: accounts.length };
  }, [accounts]);

  function setMapping(accountNumber: string, value: string | null) {
    setAccounts((prev) =>
      prev.map((a) => (a.number === accountNumber ? { ...a, mappedTo: value } : a))
    );
    setDirty((prev) => ({ ...prev, [accountNumber]: value }));
  }

  function applySuggestions() {
    const suggestions: Record<string, string | null> = {};
    setAccounts((prev) =>
      prev.map((a) => {
        if (a.mappedTo) return a;
        const s = suggestSection(a);
        if (!s) return a;
        suggestions[a.number] = s;
        return { ...a, mappedTo: s };
      })
    );
    setDirty((prev) => ({ ...prev, ...suggestions }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/mapping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mappings: dirty }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setDirty({});
      setMessage(`Saved ${Object.keys(dirty).length} change(s).`);
    } catch (err) {
      setMessage(`Failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const dirtyCount = Object.keys(dirty).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded border border-slate-300 bg-white p-0.5">
          {(["unmapped", "mapped", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 text-xs font-medium ${
                filter === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="ml-1 opacity-70">
                (
                {f === "all"
                  ? counts.total
                  : f === "mapped"
                  ? counts.mapped
                  : counts.unmapped}
                )
              </span>
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search number, name, sub-category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={applySuggestions}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Auto-suggest by BC sub-category
        </button>
      </div>

      <div className="overflow-hidden rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-[90px]">BC #</th>
              <th className="px-3 py-2 text-left font-medium">Account</th>
              <th className="px-3 py-2 text-left font-medium w-[160px]">Sub-category</th>
              <th className="px-3 py-2 text-right font-medium w-[130px]">
                Balance @ {initial.periodEnd}
              </th>
              <th className="px-3 py-2 text-left font-medium w-[240px]">Recon section</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{a.number}</td>
                <td className="px-3 py-1.5">
                  <div>{a.displayName}</div>
                  <div className="text-[11px] text-slate-500">{a.category}</div>
                </td>
                <td className="px-3 py-1.5 text-slate-600">{a.subCategory || "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(a.balance)}</td>
                <td className="px-3 py-1.5">
                  <select
                    value={a.mappedTo ?? ""}
                    onChange={(e) =>
                      setMapping(a.number, e.target.value === "" ? null : e.target.value)
                    }
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="">— Excluded from recon —</option>
                    {sections.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.order}. {s.title}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-500">
                  No accounts match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 mt-4 flex items-center justify-between border-t border-slate-200 bg-white/90 py-3 backdrop-blur">
        <div className="text-xs text-slate-500">
          {dirtyCount > 0 ? (
            <span className="text-amber-700">
              {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}
            </span>
          ) : message ? (
            <span>{message}</span>
          ) : (
            <>
              {counts.mapped}/{counts.total} accounts mapped
            </>
          )}
        </div>
        <button
          type="button"
          disabled={saving || dirtyCount === 0}
          onClick={save}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : `Save ${dirtyCount || ""} change${dirtyCount === 1 ? "" : "s"}`.trim()}
        </button>
      </div>
    </div>
  );
}
