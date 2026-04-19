"use client";

import { useState } from "react";
import type { SettingsSnapshot } from "@/lib/settings";
import { categoryLabels } from "@/lib/integrations";

type Props = { initial: SettingsSnapshot };

export default function SettingsForm({ initial }: Props) {
  const [snapshot, setSnapshot] = useState(initial);
  const [entityName, setEntityName] = useState(initial.entityName);
  const [periodEnd, setPeriodEnd] = useState(initial.periodEnd);
  const [integFields, setIntegFields] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function setField(integId: string, key: string, value: string) {
    setIntegFields((prev) => ({
      ...prev,
      [integId]: { ...(prev[integId] ?? {}), [key]: value },
    }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const body = {
      entityName,
      periodEnd,
      integrations: integFields,
    };
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const updated: SettingsSnapshot = await res.json();
      setSnapshot(updated);
      setIntegFields({});
      setMessage("Saved.");
    } catch (err) {
      setMessage(`Failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const grouped = snapshot.integrations.reduce<Record<string, typeof snapshot.integrations>>(
    (acc, i) => {
      (acc[i.category] ??= []).push(i);
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-8">
      <section className="rounded border border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Close Period
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Entity name is read from Business Central. Update the company on the BC integration
            below to change it.
          </p>
        </header>
        <div className="px-5 py-4 grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Period end</span>
            <input
              type="date"
              value={periodEnd || ""}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
      </section>

      {Object.entries(grouped).map(([cat, integs]) => (
        <section key={cat}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {categoryLabels[cat as keyof typeof categoryLabels] ?? cat}
          </h2>
          <div className="space-y-3">
            {integs.map((i) => (
              <div key={i.id} className="rounded border border-slate-200 bg-white">
                <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-slate-900">{i.name}</h3>
                      <StatusPill configured={i.configured} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600">{i.blurb}</p>
                  </div>
                  {i.docsUrl && (
                    <a
                      href={i.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      API docs ↗
                    </a>
                  )}
                </header>
                <div className="grid grid-cols-2 gap-4 px-5 py-4">
                  {i.fields.map((f) => {
                    const pending = integFields[i.id]?.[f.key] ?? "";
                    const placeholder =
                      f.isSet && pending === "" ? f.displayValue : f.placeholder ?? "";
                    return (
                      <label key={f.key} className="block">
                        <span className="text-xs font-medium text-slate-600">{f.label}</span>
                        <input
                          type={f.type === "secret" ? "password" : "text"}
                          value={pending}
                          onChange={(e) => setField(i.id, f.key, e.target.value)}
                          placeholder={placeholder}
                          autoComplete="off"
                          className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono"
                        />
                        {f.help && (
                          <span className="mt-1 block text-[11px] text-slate-500">{f.help}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/80 backdrop-blur px-1 py-4">
        <div className="text-xs text-slate-500">
          Secrets encrypted with AES-256-GCM and stored locally in <code>.data/settings.json</code>.
          Never committed.
        </div>
        <div className="flex items-center gap-3">
          {message && <span className="text-xs text-slate-600">{message}</span>}
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ configured }: { configured: boolean }) {
  return configured ? (
    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
      Configured
    </span>
  ) : (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
      Not set
    </span>
  );
}
