/**
 * MetricCard — shared stat/KPI box used across the dashboard, data-prep
 * tools, and plan page. Replaces the local Stat, Panel, and StatPill
 * components that each had slightly different styling.
 *
 * Usage:
 *   <MetricCard label="Total Assets" value={fmt(total)} />
 *   <MetricCard label="Discrepancies" value="3" tone="warn" />
 *   <MetricCard label="Automatable" value={12} tone="ok" />
 */

type Tone = "neutral" | "ok" | "warn";

type Props = {
  label: string;
  value: string | number;
  tone?: Tone;
};

const toneClasses: Record<Tone, { border: string; value: string; bg: string }> = {
  neutral: {
    border: "border-slate-200",
    value: "text-slate-900",
    bg: "bg-white",
  },
  ok: {
    border: "border-emerald-200",
    value: "text-emerald-700",
    bg: "bg-emerald-50/40",
  },
  warn: {
    border: "border-amber-200",
    value: "text-amber-700",
    bg: "bg-amber-50/40",
  },
};

export default function MetricCard({ label, value, tone = "neutral" }: Props) {
  const { border, value: valueCls, bg } = toneClasses[tone];
  return (
    <div className={`rounded border px-4 py-3 ${border} ${bg}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueCls}`}>
        {value}
      </div>
    </div>
  );
}
