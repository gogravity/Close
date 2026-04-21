#!/usr/bin/env node
/**
 * Apply payments to stale CW AR invoices to zero out their balances.
 * Stale = balance > 0 in CW, but NOT open in BC (already paid/closed there).
 *
 * Strategy:
 *   - If the invoice has NO existing payment record → POST a new payment
 *   - If it already HAS a payment record → PATCH it to cover the full balance
 *
 * Usage:
 *   node scripts/close-stale-cw-ar.mjs [--dry-run] [--before=YYYY-MM-DD]
 */

import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");
const beforeArg = process.argv.find((a) => a.startsWith("--before="))?.split("=")[1];
const BEFORE_DATE = beforeArg ?? null;
const CONCURRENCY = 5; // parallel payment requests

if (DRY_RUN) console.log("🔍 DRY RUN — no changes will be made.\n");
if (BEFORE_DATE) console.log(`📅 Only processing invoices dated before ${BEFORE_DATE}\n`);

// ── Crypto ────────────────────────────────────────────────────────────────────

async function loadMasterKey() {
  const hex = (await readFile(path.join(ROOT, ".data", "master.key"), "utf8")).trim();
  return Buffer.from(hex, "hex");
}

function decrypt(blob, key) {
  const [, ivB64, tagB64, ctB64] = blob.split(":");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([d.update(Buffer.from(ctB64, "base64")), d.final()]).toString("utf8");
}

async function getField(settings, key, integration, fieldName) {
  const f = settings.integrations[integration]?.[fieldName];
  if (!f) throw new Error(`Missing field ${integration}.${fieldName}`);
  return f.encrypted ? decrypt(f.value, key) : f.value;
}

// ── CW helpers ────────────────────────────────────────────────────────────────

function makeCwHeaders(creds) {
  const auth = Buffer.from(`${creds.companyId}+${creds.publicKey}:${creds.privateKey}`).toString("base64");
  return { Authorization: `Basic ${auth}`, clientId: creds.clientId, "Content-Type": "application/json" };
}

function cwBase(creds) {
  const host = creds.siteUrl.replace(/^https?:\/\//i, "").split("/")[0];
  return `https://${host}/v4_6_release/apis/3.0`;
}

async function cwFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CW ${res.status}: ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function listAllCwInvoicesWithBalance(creds) {
  const base = cwBase(creds);
  const headers = makeCwHeaders(creds);
  const fields = "id,invoiceNumber,date,dueDate,balance,total,company";
  let page = 1;
  const results = [];
  while (true) {
    const url = `${base}/finance/invoices?conditions=balance>0&fields=${fields}&pageSize=1000&page=${page}`;
    const data = await cwFetch(url, { headers });
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < 1000) break;
    page++;
  }
  return results;
}

async function getInvoicePayments(creds, invoiceId) {
  const base = cwBase(creds);
  const headers = makeCwHeaders(creds);
  const data = await cwFetch(`${base}/finance/invoices/${invoiceId}/payments?pageSize=100`, { headers });
  return Array.isArray(data) ? data : [];
}

async function postPayment(creds, invoiceId, amount, paymentDate) {
  const base = cwBase(creds);
  const headers = makeCwHeaders(creds);
  return cwFetch(`${base}/finance/invoices/${invoiceId}/payments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "P", amount, paymentDate }),
  });
}

async function patchPayment(creds, invoiceId, paymentId, amount, paymentDate) {
  const base = cwBase(creds);
  const headers = makeCwHeaders(creds);
  return cwFetch(`${base}/finance/invoices/${invoiceId}/payments/${paymentId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify([
      { op: "replace", path: "amount", value: amount },
      { op: "replace", path: "paymentDate", value: paymentDate },
    ]),
  });
}

// ── BC helpers ────────────────────────────────────────────────────────────────

async function getBcToken(creds) {
  const res = await fetch(
    `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        scope: "https://api.businesscentral.dynamics.com/.default",
      }),
    }
  );
  if (!res.ok) throw new Error(`BC auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function getBcCompanyId(token, creds) {
  const url = `https://api.businesscentral.dynamics.com/v2.0/${creds.tenantId}/${creds.environmentName}/api/v2.0/companies?$filter=name eq '${encodeURIComponent(creds.companyName)}'`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`BC companies fetch failed: ${res.status}`);
  return (await res.json()).value?.[0]?.id;
}

async function getBcOpenKeys(token, tenantId, envName, companyId) {
  const base = `https://api.businesscentral.dynamics.com/v2.0/${tenantId}/${envName}/api/v2.0/companies(${companyId})`;
  const [invRes, cmRes] = await Promise.all([
    fetch(`${base}/salesInvoices?$filter=status eq 'Open'&$select=number,externalDocumentNumber&$top=5000`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${base}/salesCreditMemos?$filter=postingDate ge ${new Date().getUTCFullYear() - 3}-01-01&$select=number,externalDocumentNumber&$top=5000`, { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  const invs = invRes.ok ? (await invRes.json()).value ?? [] : [];
  const cms  = cmRes.ok  ? (await cmRes.json()).value  ?? [] : [];
  const keys = new Set();
  for (const r of [...invs, ...cms]) {
    if (r.externalDocumentNumber) keys.add(r.externalDocumentNumber.toUpperCase());
    if (r.number) keys.add(r.number.toUpperCase());
  }
  return keys;
}

// ── Concurrency helper ────────────────────────────────────────────────────────

async function pLimit(tasks, limit) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const masterKey = await loadMasterKey();
  const settings = JSON.parse(await readFile(path.join(ROOT, ".data", "settings.json"), "utf8"));

  const cwCreds = {
    siteUrl:    await getField(settings, masterKey, "connectwise", "siteUrl"),
    companyId:  await getField(settings, masterKey, "connectwise", "companyId"),
    publicKey:  await getField(settings, masterKey, "connectwise", "publicKey"),
    privateKey: await getField(settings, masterKey, "connectwise", "privateKey"),
    clientId:   await getField(settings, masterKey, "connectwise", "clientId"),
  };
  const bcCreds = {
    tenantId:        await getField(settings, masterKey, "business-central", "tenantId"),
    environmentName: await getField(settings, masterKey, "business-central", "environmentName"),
    clientId:        await getField(settings, masterKey, "business-central", "clientId"),
    clientSecret:    await getField(settings, masterKey, "business-central", "clientSecret"),
    companyName:     await getField(settings, masterKey, "business-central", "companyName"),
  };

  console.log("📡 Fetching CW invoices with balance > 0...");
  const cwInvoices = await listAllCwInvoicesWithBalance(cwCreds);
  console.log(`   → ${cwInvoices.length} invoices`);

  console.log("📡 Fetching BC open invoice keys...");
  const bcToken = await getBcToken(bcCreds);
  const bcCompanyId = await getBcCompanyId(bcToken, bcCreds);
  const bcKeys = await getBcOpenKeys(bcToken, bcCreds.tenantId, bcCreds.environmentName, bcCompanyId);
  console.log(`   → ${bcKeys.size} BC open keys\n`);

  // Find stale
  let stale = cwInvoices.filter(
    (inv) => (inv.balance ?? 0) > 0.005 && !bcKeys.has(inv.invoiceNumber.toUpperCase())
  );

  if (BEFORE_DATE) {
    const filtered = stale.filter((inv) => !inv.date || inv.date < BEFORE_DATE);
    console.log(`⏭️  Filtering to pre-${BEFORE_DATE}: ${stale.length} → ${filtered.length} invoices\n`);
    stale = filtered;
  }

  const totalBalance = stale.reduce((s, inv) => s + (inv.balance ?? 0), 0);
  const recent = stale.filter((inv) => inv.date >= "2025-01-01");
  if (recent.length) {
    console.warn(`⚠️  ${recent.length} invoices are 2025 or newer — add --before=2025-01-01 to exclude them.\n`);
  }

  console.log(`🔎 ${stale.length} stale invoices · total balance $${totalBalance.toFixed(2)}\n`);
  if (stale.length === 0) { console.log("✅ Nothing to do."); return; }

  if (DRY_RUN) {
    for (const inv of stale.slice(0, 50)) {
      console.log(`  ${inv.invoiceNumber.padEnd(20)} ${(inv.date ?? "").slice(0,10)}  ${(inv.company?.name ?? "").padEnd(40)} $${(inv.balance ?? 0).toFixed(2)}`);
    }
    if (stale.length > 50) console.log(`  ... and ${stale.length - 50} more`);
    console.log("\n🔍 Dry run complete.");
    return;
  }

  // Apply payments
  let applied = 0, patched = 0, failed = 0;

  const tasks = stale.map((inv) => async () => {
    const balance = inv.balance ?? 0;
    const paymentDate = (inv.date ?? new Date().toISOString()).replace("Z", "").slice(0, 10) + "T00:00:00Z";
    try {
      const existing = await getInvoicePayments(cwCreds, inv.id);
      if (existing.length === 0) {
        await postPayment(cwCreds, inv.id, balance, paymentDate);
        console.log(`  ✅ POST  ${inv.invoiceNumber.padEnd(20)} ${(inv.company?.name ?? "").padEnd(35)} $${balance.toFixed(2)}`);
        applied++;
      } else {
        // Patch existing payment to cover full balance
        const existingPayment = existing[0];
        const newAmount = existingPayment.amount + balance;
        await patchPayment(cwCreds, inv.id, existingPayment.id, newAmount, paymentDate);
        console.log(`  🔄 PATCH ${inv.invoiceNumber.padEnd(20)} ${(inv.company?.name ?? "").padEnd(35)} $${balance.toFixed(2)} (existing pmt updated)`);
        patched++;
      }
    } catch (err) {
      console.error(`  ❌ FAIL  ${inv.invoiceNumber.padEnd(20)} ${err.message.slice(0, 80)}`);
      failed++;
    }
  });

  await pLimit(tasks, CONCURRENCY);

  console.log(`\n📊 Done.`);
  console.log(`   Posted new payments:   ${applied}`);
  console.log(`   Patched existing:      ${patched}`);
  console.log(`   Failed:                ${failed}`);
  console.log(`   Total balance cleared: $${totalBalance.toFixed(2)}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
