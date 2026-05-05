import "server-only";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

const TTL_MS = 5 * 60 * 1000;

type CacheEntry = { value: string | null; expires: number };
const cache = new Map<string, CacheEntry>();

let client: SecretClient | null = null;
let clientInitialized = false;

function getClient(): SecretClient | null {
  if (clientInitialized) return client;
  clientInitialized = true;
  const explicitUrl = process.env.AZURE_KEY_VAULT_URL?.trim();
  const name = process.env.AZURE_KEY_VAULT_NAME?.trim();
  const url = explicitUrl || (name ? `https://${name}.vault.azure.net` : "");
  if (!url) return null;
  client = new SecretClient(url, new DefaultAzureCredential());
  return client;
}

export function isKeyVaultEnabled(): boolean {
  return Boolean(getClient());
}

export async function getVaultSecret(name: string): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  const cached = cache.get(name);
  const now = Date.now();
  if (cached && cached.expires > now) return cached.value;
  try {
    const secret = await c.getSecret(name);
    const value = secret.value ?? null;
    cache.set(name, { value, expires: now + TTL_MS });
    return value;
  } catch (err: unknown) {
    const code = (err as { code?: string; statusCode?: number })?.code;
    const status = (err as { statusCode?: number })?.statusCode;
    if (code === "SecretNotFound" || status === 404) {
      cache.set(name, { value: null, expires: now + TTL_MS });
      return null;
    }
    throw err;
  }
}

export async function setVaultSecret(name: string, value: string): Promise<void> {
  const c = getClient();
  if (!c) throw new Error("Key Vault not configured");
  await c.setSecret(name, value);
  cache.set(name, { value, expires: Date.now() + TTL_MS });
}
