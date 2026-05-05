import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import "server-only";
import { decrypt, encrypt, maskSecret } from "./crypto";
import { integrations, resolveVaultSecretName, type Integration } from "./integrations";
import { getVaultSecret, isKeyVaultEnabled } from "./keyVault";

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
    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    return { ...parsed, integrations: parsed.integrations ?? {} };
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
  keyVaultEnabled: boolean;
};

export async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  const data = await readRaw();
  const kvEnabled = isKeyVaultEnabled();
  const snapshot: SettingsSnapshot = {
    entityName: data.entityName ?? "",
    periodEnd: data.periodEnd ?? "",
    integrations: [],
    keyVaultEnabled: kvEnabled,
  };
  for (const integ of integrations) {
    const stored = data.integrations[integ.id] ?? {};
    const fields: FieldStatus[] = [];
    let allSet = integ.fields.length > 0;
    for (const f of integ.fields) {
      const entry = stored[f.key];
      let isSet = Boolean(entry?.value);
      let displayValue = "";
      if (kvEnabled) {
        const kvVal = await getVaultSecret(resolveVaultSecretName(integ, f));
        if (kvVal) {
          isSet = true;
          displayValue = f.type === "secret" ? maskSecret(kvVal) : kvVal;
        }
      }
      if (!displayValue && entry?.value) {
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
      if (!isSet) allSet = false;
      fields.push({ ...f, isSet, displayValue });
    }
    snapshot.integrations.push({
      id: integ.id,
      name: integ.name,
      category: integ.category,
      blurb: integ.blurb,
      docsUrl: integ.docsUrl,
      fields,
      configured: allSet,
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
  if (req.integrations && Object.keys(req.integrations).length > 0) {
    if (isKeyVaultEnabled()) {
      throw new Error("Integration credentials are managed by Azure Key Vault and cannot be edited from the UI.");
    }
    for (const [integId, fields] of Object.entries(req.integrations)) {
      const integ = integrations.find((i) => i.id === integId);
      if (!integ) continue;
      const existing = data.integrations[integId] ?? {};
      for (const f of integ.fields) {
        if (!(f.key in fields)) continue;
        const val = (fields[f.key] ?? "").trim();
        if (val === "") {
          // Empty string means "leave as-is" — the client strips blanks before
          // sending, so receiving one here means something slipped through.
          // Never silently delete an existing credential.
          continue;
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
  const integ = integrations.find((i) => i.id === integId);
  const out: Record<string, string> = {};
  if (!integ) return out;

  const kvEnabled = isKeyVaultEnabled();
  if (kvEnabled) {
    const results = await Promise.all(
      integ.fields.map(async (f) => {
        const v = await getVaultSecret(resolveVaultSecretName(integ, f));
        return [f.key, v] as const;
      })
    );
    for (const [k, v] of results) {
      if (v) out[k] = v;
    }
  }

  const data = await readRaw();
  const stored = data.integrations[integId] ?? {};
  for (const f of integ.fields) {
    if (out[f.key]) continue;
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
  const [bc, cw] = await Promise.all([
    getIntegrationSecrets("business-central"),
    getIntegrationSecrets("connectwise"),
  ]);
  const bcConfigured = ["tenantId", "environmentName", "companyName", "clientId", "clientSecret"].every(
    (k) => Boolean(bc[k])
  );
  const cwConfigured = ["siteUrl", "companyId", "publicKey", "privateKey", "clientId"].every((k) =>
    Boolean(cw[k])
  );
  return {
    name: bc.companyName ?? "",
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
