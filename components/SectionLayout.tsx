/**
 * SectionLayout — standard page wrapper for BS-Recon section pages and
 * data-prep tools. Keeps the px-8 py-8 max-w container, breadcrumb back
 * link, and header (section label + h1 + description) consistent across
 * every page.
 *
 * Usage:
 *   <SectionLayout
 *     backHref="/"
 *     backLabel="Balance Sheet Summary"
 *     eyebrow="Section 8 · Period ending 2026-03-31"
 *     title="Accrued Payroll"
 *     description="Reconciles account 202010…"
 *   >
 *     {children}
 *   </SectionLayout>
 */

import Link from "next/link";

type Props = {
  children: React.ReactNode;
  /** Back-nav link href (e.g. "/" or "/data-prep") */
  backHref?: string;
  /** Back-nav link label */
  backLabel?: string;
  /** Small uppercase line above the h1 */
  eyebrow?: string;
  /** Page title — rendered as h1 */
  title: string;
  /** Optional subtitle paragraph below the h1 */
  description?: React.ReactNode;
  /** Max-width override; defaults to max-w-[1400px] */
  maxWidth?: string;
};

export default function SectionLayout({
  children,
  backHref,
  backLabel,
  eyebrow,
  title,
  description,
  maxWidth = "max-w-[1400px]",
}: Props) {
  return (
    <div className={`px-8 py-8 ${maxWidth}`}>
      {backHref && (
        <Link href={backHref} className="text-sm text-slate-500 hover:text-slate-900">
          ← {backLabel ?? "Back"}
        </Link>
      )}
      <header className={`${backHref ? "mt-3" : ""} mb-6`}>
        {eyebrow && (
          <div className="text-xs uppercase tracking-wide text-slate-500">{eyebrow}</div>
        )}
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        )}
      </header>
      {children}
    </div>
  );
}
