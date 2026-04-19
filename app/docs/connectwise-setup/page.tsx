import Link from "next/link";

export const metadata = {
  title: "ConnectWise API Member Setup",
};

type Permission = {
  module: string;
  table: string;
  inquire: "All" | "None";
  add: "None";
  edit: "None";
  delete: "None";
  why: string;
};

const permissions: Permission[] = [
  {
    module: "Companies",
    table: "Company Maintenance",
    inquire: "All",
    add: "None",
    edit: "None",
    delete: "None",
    why: "Read the tenant company info (entity name, address) on first launch.",
  },
  {
    module: "Finance",
    table: "Invoice",
    inquire: "All",
    add: "None",
    edit: "None",
    delete: "None",
    why: "Billed invoices for AR aging tie-out and deferred-revenue recognition.",
  },
  {
    module: "Finance",
    table: "Agreements",
    inquire: "All",
    add: "None",
    edit: "None",
    delete: "None",
    why: "Block-hour agreements + additions → deferred revenue balance.",
  },
  {
    module: "Finance",
    table: "Accounting Interface",
    inquire: "All",
    add: "None",
    edit: "None",
    delete: "None",
    why: "Read GL posting status for time entries and invoices (needed to classify unbilled vs billed).",
  },
  {
    module: "Time",
    table: "Time Entry",
    inquire: "All",
    add: "None",
    edit: "None",
    delete: "None",
    why: "Logged time entries → unbilled-time-revenue accrual.",
  },
  {
    module: "Service Desk",
    table: "Service Tickets",
    inquire: "All",
    add: "None",
    edit: "None",
    delete: "None",
    why: "Needed to join time entries back to billable work orders.",
  },
  {
    module: "Project",
    table: "Project Tickets",
    inquire: "All",
    add: "None",
    edit: "None",
    delete: "None",
    why: "Project work orders that carry unbilled time.",
  },
  {
    module: "System",
    table: "API Reports",
    inquire: "All",
    add: "None",
    edit: "None",
    delete: "None",
    why: "Required for any paginated API query against finance/time data.",
  },
];

export default function ConnectWiseSetupPage() {
  return (
    <div className="px-8 py-10 max-w-4xl">
      <Link href="/onboarding" className="text-sm text-slate-500 hover:text-slate-900">
        ← Back to Onboarding
      </Link>
      <header className="mt-3 mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">Setup Guide</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          ConnectWise Manage: Create a dedicated API member
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          This app should not use your personal ConnectWise credentials. Follow these steps to
          create an API-only member with a least-privilege security role scoped to exactly what
          the reconciliation workflow reads.
        </p>
      </header>

      <Section title="1. Create the Security Role">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>
            In ConnectWise Manage, go to <em>System → Security Roles</em>.
          </li>
          <li>
            Click <strong>+ New</strong>. Name the role <code>BS Recon API</code>. Description:{" "}
            <em>Read-only service account for balance-sheet reconciliation app.</em>
          </li>
          <li>
            Click <strong>Save</strong>, then open the role you just created.
          </li>
          <li>
            For <strong>every module below</strong>, expand it and set permissions exactly as
            shown. Everything not listed should stay at <code>None</code> across all four
            columns.
          </li>
        </ol>

        <div className="mt-4 overflow-hidden rounded border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Module</th>
                <th className="px-3 py-2 text-left font-medium">Table / Permission</th>
                <th className="px-3 py-2 text-center font-medium">Inquire</th>
                <th className="px-3 py-2 text-center font-medium">Add</th>
                <th className="px-3 py-2 text-center font-medium">Edit</th>
                <th className="px-3 py-2 text-center font-medium">Delete</th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((p, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 text-slate-700">{p.module}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{p.table}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{p.why}</div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Pill level={p.inquire} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Pill level={p.add} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Pill level={p.edit} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Pill level={p.delete} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          The app is strictly read-only in this phase. If we add write-back later (e.g. posting
          a reconciliation worksheet to CW), we&apos;ll extend this role in a separate pass and
          update this doc.
        </p>
      </Section>

      <Section title="2. Create the API Member">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>
            Go to <em>System → Members → API Members</em> tab, click <strong>+ New</strong>.
          </li>
          <li>
            <strong>Member ID</strong>: <code>bs-recon</code> (or similar identifier).
          </li>
          <li>
            <strong>Role ID</strong>: <code>BS Recon API</code> (the role from Step 1).
          </li>
          <li>
            <strong>Level</strong>: <code>Corporate (Level 1)</code> — grants the role
            visibility across all locations in your tenant.
          </li>
          <li>
            <strong>Location</strong> / <strong>Business Unit</strong>: set to your root
            corporate location.
          </li>
          <li>
            Leave <strong>Assignable</strong> unchecked — this member should not own tickets.
          </li>
          <li>
            Save the member. ConnectWise will email the creator a one-time setup — ignore;
            we&apos;re using API keys, not password auth.
          </li>
        </ol>
      </Section>

      <Section title="3. Generate the API Keys">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>
            Open the API member you created and switch to the <strong>API Keys</strong> tab.
          </li>
          <li>
            Click <strong>+ New</strong>. Description: <code>BS Recon App</code>.
          </li>
          <li>
            Save. CW displays a <strong>Public Key</strong> and <strong>Private Key</strong>{" "}
            <em>once</em>. Copy both immediately.
          </li>
          <li>
            Paste them into the onboarding form for ConnectWise — they are stored
            encrypted-at-rest on this host (AES-256-GCM) and never leave it.
          </li>
        </ol>
      </Section>

      <Section title="4. Register a Client ID">
        <p className="text-sm text-slate-700">
          ConnectWise requires a <code>clientId</code> header on every API request (separate
          from the member public/private key pair). Register one once per app:
        </p>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>
            Go to{" "}
            <a
              href="https://developer.connectwise.com/ClientID"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline"
            >
              developer.connectwise.com/ClientID
            </a>
            .
          </li>
          <li>
            Register a new app (<em>BS Recon</em>, internal use). Capture the generated
            Client ID GUID.
          </li>
          <li>Paste it into the onboarding form as the ConnectWise Client ID.</li>
        </ol>
      </Section>

      <Section title="5. Find the other values">
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li>
            <strong>Site URL</strong>: the hostname of your CW instance (e.g.{" "}
            <code>na.myconnectwise.net</code>). Do <em>not</em> include <code>https://</code> or
            trailing paths.
          </li>
          <li>
            <strong>Company ID</strong>: shown on the CW login page above the password field
            (not the friendly name of your company — the short identifier).
          </li>
        </ul>
      </Section>

      <Section title="6. Validate">
        <p className="text-sm text-slate-700">
          After you save credentials in onboarding, the app will make one test call to{" "}
          <code>/system/info</code> to confirm the keys work and the role has enough scope to
          read at least that endpoint. If any of the above permissions are missing, later
          section pulls (AR, Deferred Revenue, Unbilled Revenue) will surface a <em>missing
          permission</em> hint that points back to this doc.
        </p>
      </Section>

      <div className="mt-10 flex gap-3">
        <Link
          href="/onboarding"
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Return to Onboarding
        </Link>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function Pill({ level }: { level: "All" | "None" }) {
  const cls =
    level === "All"
      ? "bg-emerald-100 text-emerald-800"
      : "bg-slate-100 text-slate-500";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {level}
    </span>
  );
}
