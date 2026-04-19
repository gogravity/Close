import "server-only";
import { getIntegrationSecrets } from "./settings";

export class RampError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "RampError";
  }
}

type RampCredentials = {
  clientId: string;
  clientSecret: string;
  environment: string; // "production" | "demo"
};

async function loadCredentials(): Promise<RampCredentials> {
  const s = await getIntegrationSecrets("ramp");
  if (!s.clientId || !s.clientSecret)
    throw new RampError("Ramp credentials not configured", 400);
  return {
    clientId: s.clientId,
    clientSecret: s.clientSecret,
    environment: s.environment || "production",
  };
}

function baseUrl(env: string): string {
  return env === "demo" ? "https://demo-api.ramp.com/developer/v1" : "https://api.ramp.com/developer/v1";
}

type TokenCache = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenCache>();

async function getAccessToken(creds: RampCredentials): Promise<string> {
  const key = `${creds.environment}/${creds.clientId}`;
  const cached = tokenCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 30_000) return cached.token;

  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "transactions:read receipts:read statements:read",
  });
  const res = await fetch(`${baseUrl(creds.environment)}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    throw new RampError(`Ramp token ${res.status} ${res.statusText}`, res.status, parsed);
  }
  const payload = JSON.parse(text) as { access_token: string; expires_in: number };
  tokenCache.set(key, {
    token: payload.access_token,
    expiresAt: now + payload.expires_in * 1000,
  });
  return payload.access_token;
}

async function rampGet<T>(path: string, isRetry = false): Promise<T> {
  const creds = await loadCredentials();
  const cacheKey = `${creds.environment}/${creds.clientId}`;
  // On retry after an auth/scope error, drop the cached token so we get a
  // fresh one that reflects any scope changes made in Ramp's admin UI.
  if (isRetry) tokenCache.delete(cacheKey);
  const token = await getAccessToken(creds);
  const res = await fetch(`${baseUrl(creds.environment)}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    // 401 (token revoked) or 403 with a scope-related message → invalidate
    // cache and retry once. Covers the case where a scope was just enabled
    // in Ramp but our token was minted before the change.
    const isAuthRetry =
      !isRetry &&
      (res.status === 401 ||
        (res.status === 403 &&
          /scope|not allowed/i.test(
            (parsed as { error_v2?: { message?: string } } | undefined)?.error_v2
              ?.message ?? text
          )));
    if (isAuthRetry) {
      return rampGet<T>(path, true);
    }
    throw new RampError(`Ramp ${res.status} ${res.statusText}`, res.status, parsed);
  }
  return JSON.parse(text) as T;
}

export type RampTransaction = {
  id: string;
  amount: number;
  currency_code: string;
  merchant_name: string;
  merchant_descriptor?: string;
  merchant_category_code?: string;
  merchant_category_code_description?: string;
  user_transaction_time: string;
  card_holder?: { first_name?: string; last_name?: string; department_name?: string };
  sk_category_name?: string;
  memo?: string;
  state: string;
  receipts?: string[];
};

export type RampSearchResult = {
  transactions: RampTransaction[];
  searched: {
    fromDate: string;
    toDate: string;
    amountMin: number;
    amountMax: number;
  };
};

export type RampStatementMoney = {
  amount: number; // in minor units (cents)
  currency_code: string;
  minor_unit_conversion_rate: number;
};

export type RampStatement = {
  id: string;
  start_date: string; // ISO with timezone
  end_date: string;
  opening_balance: RampStatementMoney;
  ending_balance: RampStatementMoney;
  charges: RampStatementMoney;
  payments: RampStatementMoney;
  credits: RampStatementMoney;
  statement_url?: string;
  preceding_statement_id?: string;
  balance_sections?: unknown[];
  statement_lines?: unknown[];
};

export function toDollars(m: RampStatementMoney | undefined): number {
  if (!m) return 0;
  return m.amount / (m.minor_unit_conversion_rate || 100);
}

/**
 * Lists Ramp statements, most-recent first. Scope: statements:read.
 */
export async function listStatements(limit = 12): Promise<RampStatement[]> {
  const qs = new URLSearchParams({ page_size: String(limit) });
  const res = await rampGet<{ data: RampStatement[] }>(
    `/statements?${qs.toString()}`
  );
  return res.data ?? [];
}

export type RampReceipt = {
  id: string;
  transaction_id: string;
  receipt_url: string;
  content_type?: string;
};

/**
 * Fetch a single Ramp receipt record. Returns the pre-signed URL you can
 * use to download the actual file.
 */
export async function getReceipt(receiptId: string): Promise<RampReceipt> {
  return rampGet<RampReceipt>(`/receipts/${encodeURIComponent(receiptId)}`);
}

/**
 * Proxies the receipt file through us so the browser never hits Ramp's
 * pre-signed URL directly.
 */
export async function fetchReceiptFile(
  receiptId: string
): Promise<{ buf: ArrayBuffer; contentType: string }> {
  const creds = await loadCredentials();
  void creds;
  const receipt = await getReceipt(receiptId);
  const res = await fetch(receipt.receipt_url, { cache: "no-store" });
  if (!res.ok) {
    throw new RampError(
      `Receipt file ${res.status} ${res.statusText}`,
      res.status,
      await res.text().catch(() => undefined)
    );
  }
  const contentType = receipt.content_type || res.headers.get("content-type") || "application/pdf";
  const buf = await res.arrayBuffer();
  return { buf, contentType };
}

/**
 * Search Ramp transactions by amount and a date window. Useful for matching
 * a BC GL expense entry back to the Ramp card charge that originated it.
 */
export async function searchTransactionsByAmount(
  amount: number,
  postingDate: string,
  windowDays = 7
): Promise<RampSearchResult> {
  // BC posting date can be up to ~7 days after the Ramp settlement date.
  // We fetch by date window and filter by amount in-process — Ramp's amount
  // filter params are finicky (422s on some formats), and the volume per
  // week is small enough to filter locally.
  const end = new Date(postingDate);
  const start = new Date(postingDate);
  start.setUTCDate(start.getUTCDate() - windowDays);
  const tolerance = Math.max(0.01, amount * 0.001);
  const amountMin = amount - tolerance;
  const amountMax = amount + tolerance;
  // Ramp requires full ISO 8601 datetimes with timezone, not just YYYY-MM-DD.
  const fromDate = `${start.toISOString().slice(0, 10)}T00:00:00Z`;
  const toDate = `${end.toISOString().slice(0, 10)}T23:59:59Z`;

  const qs = new URLSearchParams({
    from_date: fromDate,
    to_date: toDate,
    page_size: "100",
  });

  const res = await rampGet<{ data: RampTransaction[] }>(
    `/transactions?${qs.toString()}`
  );
  const all = res.data ?? [];
  const filtered = all.filter(
    (t) => t.amount >= amountMin && t.amount <= amountMax
  );
  return {
    transactions: filtered,
    searched: { fromDate, toDate, amountMin, amountMax },
  };
}
