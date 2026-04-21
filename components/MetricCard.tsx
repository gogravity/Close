type Tone = "neutral" | "ok" | "warn";

type Props = {
  label: string;
  value: string | number;
  tone?: Tone;
};

export default function MetricCard({ label, value, tone = "neutral" }: Props) {
  const accentBar =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : "bg-transparent";

  const valueColor =
    tone === "ok"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : "text-slate-900";

  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className={`absolute inset-y-0 left-0 w-[3px] ${accentBar}`} />
      <div className="px-4 py-3 pl-5">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          {label}
        </div>
        <div className={`mt-1.5 text-xl font-semibold tabular-nums leading-none ${valueColor}`}>
          {value}
        </div>
      </div>
    </div>
  );
}
