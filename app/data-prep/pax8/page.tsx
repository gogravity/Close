import type { Metadata } from "next";
import Pax8Client from "./Pax8Client";

export const metadata: Metadata = { title: "Pax8 Bill" };

export default function Pax8Page() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Pax8 Bill</h1>
        <p className="mt-1 text-sm text-slate-500">
          Monthly invoice breakdown, per-client cost detail, and estimated vs actual comparison
        </p>
      </div>
      <Pax8Client />
    </div>
  );
}
