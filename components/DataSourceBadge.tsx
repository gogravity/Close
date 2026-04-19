import type { DataSource } from "@/lib/recon";

const styles: Record<DataSource["status"], string> = {
  ready: "bg-emerald-100 text-emerald-800 border-emerald-200",
  planned: "bg-amber-100 text-amber-800 border-amber-200",
  "formula-driven": "bg-slate-100 text-slate-700 border-slate-200",
  manual: "bg-sky-100 text-sky-800 border-sky-200",
};

const kindLabel: Record<DataSource["kind"], string> = {
  api: "API",
  manual: "Manual",
  schedule: "Schedule",
};

export default function DataSourceBadge({ source }: { source: DataSource }) {
  return (
    <div className={`flex items-start gap-3 rounded border px-3 py-2 ${styles[source.status]}`}>
      <span className="inline-flex shrink-0 items-center rounded bg-white/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
        {kindLabel[source.kind]}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{source.system}</span>
          <span className="text-[10px] uppercase tracking-wide opacity-70">{source.status}</span>
        </div>
        {source.note && <div className="mt-0.5 text-xs opacity-80">{source.note}</div>}
      </div>
    </div>
  );
}
