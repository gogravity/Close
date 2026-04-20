export const dynamic = "force-dynamic";

export default function PayrollPage() {
  return (
    <div className="px-8 py-8 max-w-3xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">Data Preparation</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Payroll</h1>
        <p className="mt-1 text-sm text-slate-600">
          Reconcile Gusto payroll runs to the corresponding BC journal entries
          on the payroll liability accounts.
        </p>
      </header>
      <div className="rounded border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
        <div className="font-medium text-slate-700">Coming soon</div>
        <div className="mt-1">
          Paused while we reverse-engineer the current Gusto → BC posting
          pattern. Once we know the shape of a Gusto purchase invoice in BC
          and the matching GL lines, this page will compare the two.
        </div>
      </div>
    </div>
  );
}
