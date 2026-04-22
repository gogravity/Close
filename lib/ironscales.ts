/**
 * Ironscales API client — ported from stratus-bot/sync/ironscales_sync.py
 *
 * Auth: API key → JWT via POST /appapi/get-token/
 * Base: https://appapi.ironscales.com
 */
import "server-only";
import { getIntegrationSecrets } from "./settings";

export class IronscalesError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "IronscalesError";
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getApiKey(): Promise<string> {
  const s = await getIntegrationSecrets("ironscales");
  if (!s.apiKey)
    throw new IronscalesError(
      "Ironscales API key not configured — add it in Settings → Ironscales",
      400
    );
  return s.apiKey;
}

async function getToken(): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 30_000) return _tokenCache.token;

  const apiKey = await getApiKey();
  const res = await fetch("https://appapi.ironscales.com/appapi/get-token/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ key: apiKey, scopes: ["company.all", "partner.all"] }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new IronscalesError(`Ironscales auth failed (${res.status}): ${body}`, res.status);
  }
  const data = (await res.json()) as { jwt: string };
  // JWTs from Ironscales are typically valid for 1 hour
  _tokenCache = { token: data.jwt, expiresAt: now + 55 * 60 * 1000 };
  return _tokenCache.token;
}

async function ironscalesGet<T>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`https://appapi.ironscales.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new IronscalesError(`Ironscales ${path} failed (${res.status}): ${body}`, res.status);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type IronscalesCompany = {
  id: string;
  name: string;
  domain: string;
};

export type IronscalesCompanyStats = {
  companyId: string;
  companyName: string;
  domain: string;
  planType: string;
  /** Seats licensed (mailboxLimit from API) */
  licensedMailboxes: number;
  /** Seats actually protected per the API */
  protectedMailboxes: number;
};

const PLAN_LABELS: Record<string, string> = {
  "complete protect": "Complete Protect",
  "email protect":    "Email Protect",
  core:               "Core",
};

// Pax8 SKU mapping (for cross-referencing Ironscales seats against Pax8 billing)
export const IRONSCALES_SKU_MAP: Record<string, string> = {
  "complete protect": "IRN-SCL-CMP-A100",
  "email protect":    "IRN-SCL-EPR-A100",
  core:               "IRN-SCL-CRE-A100",
};

// ── API calls ─────────────────────────────────────────────────────────────────

export async function listCompanies(): Promise<IronscalesCompany[]> {
  // The response shape varies — it may be an array or { companies: [] }
  const raw = await ironscalesGet<IronscalesCompany[] | { companies?: IronscalesCompany[] }>(
    "/appapi/company/list"
  );
  return Array.isArray(raw) ? raw : (raw.companies ?? []);
}

export async function getCompanyStats(
  company: IronscalesCompany
): Promise<IronscalesCompanyStats> {
  try {
    const data = await ironscalesGet<{
      protected_mailboxes?: number;
      license?: { mailboxLimit?: number; planType?: string };
    }>(`/appapi/company/${company.id}/stats`);

    const planRaw = (data.license?.planType ?? "").toLowerCase();
    return {
      companyId:           company.id,
      companyName:         company.name,
      domain:              company.domain,
      planType:            PLAN_LABELS[planRaw] ?? data.license?.planType ?? "Unknown",
      licensedMailboxes:   data.license?.mailboxLimit ?? 0,
      protectedMailboxes:  data.protected_mailboxes ?? 0,
    };
  } catch {
    // Return a safe default so one bad company doesn't break the whole list
    return {
      companyId:           company.id,
      companyName:         company.name,
      domain:              company.domain,
      planType:            "Unknown",
      licensedMailboxes:   0,
      protectedMailboxes:  0,
    };
  }
}

/** Fetch stats for all companies in batches of 10 (parallel). */
export async function getAllCompanyStats(): Promise<IronscalesCompanyStats[]> {
  const companies = await listCompanies();
  const BATCH = 10;
  const results: IronscalesCompanyStats[] = [];
  for (let i = 0; i < companies.length; i += BATCH) {
    const batch = companies.slice(i, i + BATCH);
    const rows  = await Promise.all(batch.map((c) => getCompanyStats(c)));
    results.push(...rows);
  }
  return results.sort((a, b) => a.companyName.localeCompare(b.companyName));
}
