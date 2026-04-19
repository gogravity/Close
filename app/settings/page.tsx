import { getSettingsSnapshot } from "@/lib/settings";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const snapshot = await getSettingsSnapshot();
  return (
    <div className="px-8 py-8 max-w-4xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">Configuration</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Connect the source systems that feed the monthly close. Each credential is encrypted at
          rest with a local master key and only decrypted server-side.
        </p>
      </header>
      <SettingsForm initial={snapshot} />
    </div>
  );
}
