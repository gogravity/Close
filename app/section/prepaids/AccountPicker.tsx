"use client";

import { useEffect, useMemo, useState } from "react";

type Account = {
  number: string;
  displayName: string;
  subCategory: string;
  included: boolean;
};

export default function AccountPicker() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch("/api/prepaids/config")
      .then((r) => r.json())
      .then((d: { accounts: Account[]; isCustom: boolean }) => {
        setAccounts(d.accounts);
        setIsCustom(d.isCustom);
      });
  }, []);

  const includedCount = useMemo(
    () => accounts?.filter((a) => a.included).length ?? 0,
    [accounts]
  );

  const visible = useMemo(() => {
    if (!accounts) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.number.toLowerCase().includes(q) ||
        a.displayName.toLowerCase().includes(q) ||
        a.subCategory.toLowerCase().includes(q)
    );
  }, [accounts, filter]);

  function toggle(number: string) {
    setAccounts((prev) =>
      prev
        ? prev.map((a) => (a.number === number ? { ...a, included: !a.included } : a))
        : prev
    );
  }

  async function save() {
    if (!accounts) return;
    setSaving(true);
    try {
      const res = await fetch("/api/prepaids/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          includedAccountNumbers: accounts.filter((a) => a.included).map((a) => a.number),
        }),
      });
      if (res.ok) {
        setIsCustom(true);
        // Reload the page so the scan re-runs against the new selection.
        window.location.reload();
      }
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefaults() {
    setSaving(true);
    try {
      await fetch("/api/prepaids/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ includedAccountNumbers: [] }),
      });
      window.location.reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-6 rounded border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
      >
        <div>
          <div className="text-sm font-semibold text-slate-900">
            Scanned accounts{" "}
            {accounts && (
              <span className="font-normal text-slate-500">
                ({includedCount} of {accounts.length})
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500">
            {isCustom
              ? "Custom selection — click to edit"
              : "Default selection — travel, insurance, software, cloud, managed services, intercompany, marketing. Click to customize."}
          </div>
        </div>
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && accounts && (
        <div className="border-t border-slate-200">
          <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-100 bg-slate-50">
            <input
              type="search"
              placeholder="Search account number, name, or category…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={resetToDefaults}
              disabled={saving}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-white disabled:opacity-50"
            >
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save selection"}
            </button>
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-white text-slate-600 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium w-[40px]"></th>
                  <th className="px-3 py-2 text-left font-medium w-[90px]">Acct #</th>
                  <th className="px-3 py-2 text-left font-medium">Account</th>
                  <th className="px-3 py-2 text-left font-medium w-[220px]">Sub-category</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.number} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-1">
                      <input
                        type="checkbox"
                        checked={a.included}
                        onChange={() => toggle(a.number)}
                      />
                    </td>
                    <td className="px-3 py-1 font-mono text-[11px] text-slate-500">
                      {a.number}
                    </td>
                    <td className="px-3 py-1">{a.displayName}</td>
                    <td className="px-3 py-1 text-xs text-slate-500">{a.subCategory || "—"}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-500">
                      No accounts match the filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
