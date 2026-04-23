import type { Metadata } from "next";
import Pax8Client from "./Pax8Client";

export const metadata: Metadata = { title: "Pax8 Bill" };

export default function Pax8Page() {
  return (
    <div className="px-8 py-8 max-w-7xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">Data Preparation</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Pax8 Bill</h1>
        <p className="mt-1 text-sm text-slate-600">
          Monthly invoice breakdown, per-client cost detail, and estimated vs actual comparison
        </p>
      </header>
      <Pax8Client />
    </div>
  );
}
