"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SettingsSnapshot } from "@/lib/settings";

type Props = { initial: SettingsSnapshot };

const REQUIRED_STEPS = ["business-central", "connectwise"] as const;
const OPTIONAL_STEPS = ["ramp", "gusto", "anthropic"] as const;
const ALL_STEPS = [...REQUIRED_STEPS, ...OPTIONAL_STEPS] as const;

type StepId = (typeof ALL_STEPS)[number];

function isOptional(id: StepId): boolean {
  return (OPTIONAL_STEPS as readonly string[]).includes(id);
}

export default function OnboardingWizard({ initial }: Props) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const [stepIdx, setStepIdx] = useState(() => {
    const bc = initial.integrations.find((i) => i.id === "business-central");
    return bc?.configured ? 1 : 0;
  });
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentId = ALL_STEPS[stepIdx];
  const current = snapshot.integrations.find((i) => i.id === currentId)!;
  const optional = isOptional(currentId);
  const isLastStep = stepIdx === ALL_STEPS.length - 1;

  function setField(key: string, value: string) {
    setValues((prev) => ({
      ...prev,
      [currentId]: { ...(prev[currentId] ?? {}), [key]: value },
    }));
  }

  function advance() {
    if (isLastStep) {
      router.push("/");
      router.refresh();
    } else {
      setStepIdx(stepIdx + 1);
      setValues({});
      setError(null);
    }
  }

  async function saveAndAdvance() {
    const pending = values[currentId] ?? {};
    const hasInput = Object.values(pending).some((v) => v.trim() !== "");

    // Optional step with no input → skip without saving
    if (optional && !hasInput) {
      advance();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const body = { integrations: { [currentId]: pending } };
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const updated: SettingsSnapshot = await res.json();
      setSnapshot(updated);
      const justSaved = updated.integrations.find((i) => i.id === currentId)!;
      if (!optional && !justSaved.configured) {
        setError("All fields are required to continue.");
        return;
      }
      advance();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const filled = current.fields.every(
    (f) => Boolean(values[currentId]?.[f.key]) || f.isSet
  );
  const canSave = optional ? true : filled;

  return (
    <div>
      {/* Step indicator */}
      <div className="mb-8 space-y-2">
        {/* Required steps */}
        <ol className="flex gap-2">
          {REQUIRED_STEPS.map((id, i) => {
            const integ = snapshot.integrations.find((x) => x.id === id)!;
            const done = integ.configured;
            const active = i === stepIdx;
            return (
              <li
                key={id}
                className={`flex-1 rounded border px-3 py-2 text-xs ${
                  done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-500"
                }`}
              >
                <div className="font-semibold uppercase tracking-wide">Step {i + 1}</div>
                <div className="mt-0.5">{integ.name}</div>
                <div className="mt-0.5 opacity-80">
                  {done ? "Connected" : active ? "In progress" : "Pending"}
                </div>
              </li>
            );
          })}
        </ol>

        {/* Optional steps */}
        <ol className="flex gap-2">
          {OPTIONAL_STEPS.map((id, i) => {
            const integ = snapshot.integrations.find((x) => x.id === id)!;
            const done = integ.configured;
            const active = id === currentId;
            const globalIdx = REQUIRED_STEPS.length + i;
            return (
              <li
                key={id}
                className={`flex-1 rounded border px-3 py-2 text-xs ${
                  done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-400"
                }`}
              >
                <div className="font-semibold uppercase tracking-wide">
                  Step {globalIdx + 1}{" "}
                  <span className={`font-normal normal-case tracking-normal ${active ? "text-slate-300" : "text-slate-400"}`}>
                    · optional
                  </span>
                </div>
                <div className="mt-0.5">{integ.name}</div>
                <div className="mt-0.5 opacity-70">
                  {done ? "Connected" : active ? "In progress" : "Skip or connect"}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {currentId === "connectwise" && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-sm font-medium text-amber-900">
            Create a dedicated API member before filling this out.
          </div>
          <p className="mt-1 text-xs text-amber-800">
            Don&apos;t use your personal ConnectWise credentials. The app only needs a tightly
            scoped, read-only service account.
          </p>
          <a
            href="/docs/connectwise-setup"
            className="mt-2 inline-block text-xs font-medium text-amber-900 underline underline-offset-2"
          >
            Setup guide with exact permissions →
          </a>
        </div>
      )}

      <div className="rounded border border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{current.name}</h2>
              <p className="mt-1 text-sm text-slate-600">{current.blurb}</p>
              {current.docsUrl && (
                <a
                  href={current.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs text-blue-600 hover:underline"
                >
                  API documentation ↗
                </a>
              )}
            </div>
            {optional && (
              <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                Optional
              </span>
            )}
          </div>
        </header>
        <div className="grid grid-cols-2 gap-4 px-6 py-5">
          {current.fields.map((f) => {
            const pending = values[currentId]?.[f.key] ?? "";
            const placeholder =
              f.isSet && pending === "" ? f.displayValue : f.placeholder ?? "";
            return (
              <label key={f.key} className="block">
                <span className="text-xs font-medium text-slate-600">{f.label}</span>
                <input
                  type={f.type === "secret" ? "password" : "text"}
                  value={pending}
                  onChange={(e) => setField(f.key, e.target.value)}
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
        <footer className="flex items-center justify-between border-t border-slate-200 px-6 py-3">
          <div className="text-xs text-slate-500">
            {error ? (
              <span className="text-red-600">{error}</span>
            ) : optional ? (
              <>You can skip this and connect it later from Settings.</>
            ) : (
              <>Credentials are encrypted at rest. Your data never leaves this host.</>
            )}
          </div>
          <div className="flex items-center gap-2">
            {stepIdx > 0 && (
              <button
                type="button"
                onClick={() => { setStepIdx(stepIdx - 1); setError(null); }}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Back
              </button>
            )}
            {optional && (
              <button
                type="button"
                onClick={advance}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                {isLastStep ? "Skip & Finish" : "Skip"}
              </button>
            )}
            <button
              type="button"
              disabled={saving || !canSave}
              onClick={saveAndAdvance}
              className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving
                ? "Saving…"
                : isLastStep
                ? "Save & Finish"
                : "Save & Continue"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
