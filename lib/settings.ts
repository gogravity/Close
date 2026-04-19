import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import "server-only";
import { decrypt, encrypt, maskSecret } from "./crypto";
import { integrations, type Integration } from "./integrations";

const SETTINGS_FILE = path.join(process.cwd(), ".data", "settings.json");

type StoredField = { value: string; encrypted: boolean };
type StoredIntegration = Record<string, StoredField>;

type StoredSettings = {
  entityName?: string;
  periodEnd?: string;
  integrations: Record<string, StoredIntegration>;
  /**
   * Mapping of Business Central account number → recon section slug.
   * An unmapped account is either absent or has value null.
   */
  accountMappings?: Record<string, string | null>;
};

const EMPTY: StoredSettings = { integrations: {}, accountMappings: {} };

async function readRaw(): Promise<StoredSettings> {
  try {
    const raw = await readFile(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as StoredSettings;
    return { integrations: {}, ...parsed };
  } catch {
    return { ...EMPTY };
  }
}

async function writeRaw(data: StoredSettings): Promise<void> {
  await mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export type FieldStatus = {
  key: string;
  label: string;
  type: "text" | "secret";
  placeholder?: string;
  help?: string;
  isSet: boolean;
  displayValue: string;
};

export type IntegrationStatus = {
  id: string;
  name: string;
  category: string;
  blurb: string;
  docsUrl?: string;
  fields: FieldStatus[];
  configured: boolean;
};

export type SettingsSnapshot = {
  entityName: string;
  periodEnd: string;
  integrations: IntegrationStatus[];
};

export async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  const data = await readRaw();
  const snapshot: SettingsSnapshot = {
    entityName: data.entityName ?? "",
    periodEnd: data.periodEnd ?? "",
    integrations: [],
  };
  for (const integ of integrations) {
    const stored = data.integrations[integ.id] ?? {};
    const fields: FieldStatus[] = [];
    let anySet = false;
    for (const f of integ.fields) {
      const entry = stored[f.key];
      const isSet = Boolean(entry?.value);
      anySet = anySet || isSet;
      let displayValue = "";
      if (isSet && entry) {
        if (f.type === "secret") {
          try {
            const plain = entry.encrypted ? await decrypt(entry.value) : entry.value;
            displayValue = maskSecret(plain);
          } catch {
            displayValue = "•••• (unable to decrypt)";
          }
        } else {
          displayValue = entry.encrypted ? await decrypt(entry.value) : entry.value;
        }
      }
      fields.push({ ...f, isSet, displayValue });
    }
    snapshot.integrations.push({
      id: integ.id,
      name: integ.name,
      category: integ.category,
      blurb: integ.blurb,
      docsUrl: integ.docsUrl,
      fields,
      configured: integ.fields.length > 0 && integ.fields.every((f) => Boolean(stored[f.key]?.value)),
    });
  }
  return snapshot;
}

export type UpdateRequest = {
  entityName?: string;
  periodEnd?: string;
  integrations?: Record<string, Record<string, string>>;
};

export async function updateSettings(req: UpdateRequest): Promise<void> {
  const data = await readRaw();
  if (req.entityName !== undefined) data.entityName = req.entityName;
  if (req.periodEnd !== undefined) data.periodEnd = req.periodEnd;
  if (req.integrations) {
    for (const [integId, fields] of Object.entries(req.integrations)) {
      const integ = integrations.find((i) => i.id === integId);
      if (!integ) continue;
      const existing = data.integrations[integId] ?? {};
      for (const f of integ.fields) {
        if (!(f.key in fields)) continue;
        const val = fields[f.key] ?? "";
        if (val === "") {
          delete existing[f.key];
        } else if (f.type === "secret") {
          existing[f.key] = { value: await encrypt(val), encrypted: true };
        } else {
          existing[f.key] = { value: val, encrypted: false };
        }
      }
      data.integrations[integId] = existing;
    }
  }
  await writeRaw(data);
}

export async function getIntegrationSecrets(
  integId: string
): Promise<Record<string, string>> {
  const data = await readRaw();
  const integ = integrations.find((i) => i.id === integId);
  const stored = data.integrations[integId] ?? {};
  const out: Record<string, string> = {};
  if (!integ) return out;
  for (const f of integ.fields) {
    const entry = stored[f.key];
    if (!entry?.value) continue;
    out[f.key] = entry.encrypted ? await decrypt(entry.value) : entry.value;
  }
  return out;
}

export async function getEntityConfig(): Promise<{
  name: string;
  periodEnd: string;
  bcConfigured: boolean;
  cwConfigured: boolean;
}> {
  const data = await readRaw();
  const bc = data.integrations["business-central"] ?? {};
  const cw = data.integrations["connectwise"] ?? {};
  const bcCompanyEntry = bc["companyName"];
  const bcCompany = bcCompanyEntry?.value
    ? bcCompanyEntry.encrypted
      ? await decrypt(bcCompanyEntry.value)
      : bcCompanyEntry.value
    : "";
  const bcConfigured = ["tenantId", "environmentName", "companyName", "clientId", "clientSecret"].every(
    (k) => Boolean(bc[k]?.value)
  );
  const cwConfigured = ["siteUrl", "companyId", "publicKey", "privateKey", "clientId"].every((k) =>
    Boolean(cw[k]?.value)
  );
  return {
    name: bcCompany,
    periodEnd: data.periodEnd ?? new Date().toISOString().slice(0, 10),
    bcConfigured,
    cwConfigured,
  };
}

export async function getAccountMappings(): Promise<Record<string, string | null>> {
  const data = await readRaw();
  return data.accountMappings ?? {};
}

export async function updateAccountMappings(
  mappings: Record<string, string | null>
): Promise<void> {
  const data = await readRaw();
  const current = data.accountMappings ?? {};
  for (const [accountNumber, sectionSlug] of Object.entries(mappings)) {
    if (sectionSlug === null || sectionSlug === "") {
      delete current[accountNumber];
    } else {
      current[accountNumber] = sectionSlug;
    }
  }
  data.accountMappings = current;
  await writeRaw(data);
}

export type { Integration };
