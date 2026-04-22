import ExpenseChecklistClient from "./ExpenseChecklistClient";

export const dynamic = "force-dynamic";

function defaultPeriod(): { year: number; month: number } {
  const now = new Date();
  // Default to previous month
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export default function ExpenseChecklistPage() {
  const { year, month } = defaultPeriod();
  return (
    <div className="px-8 py-8 max-w-5xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">Data Preparation</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Expense Checklist</h1>
        <p className="mt-1 text-sm text-slate-600">
          Verify that all recurring vendor expenses were posted in Business Central for the
          selected month. Monthly items flagged in red are missing — quarterly and semi-annual
          items are shown in amber when not seen this period.
        </p>
      </header>
      <ExpenseChecklistClient defaultYear={year} defaultMonth={month} />
    </div>
  );
}
