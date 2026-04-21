#!/usr/bin/env node
// Quick test to find correct CW PATCH format for closedFlag
import { createDecipheriv } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const ROOT = '/Users/craig/projects/BS -Recon/app';
const hex = (await readFile(ROOT + '/.data/master.key', 'utf8')).trim();
const key = Buffer.from(hex, 'hex');

function decrypt(blob) {
  const [version, ivB64, tagB64, ctB64] = blob.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

const s = JSON.parse(await readFile(ROOT + '/.data/settings.json', 'utf8'));
const cw = s.integrations.connectwise;

const companyId = cw.companyId.value;
const siteUrl = cw.siteUrl.value;
const publicKey = decrypt(cw.publicKey.value);
const privateKey = decrypt(cw.privateKey.value);
const clientId = decrypt(cw.clientId.value);

const host = siteUrl.replace(/^https?:\/\//i, '').split('/')[0];
const base = `https://${host}/v4_6_release/apis/3.0`;
const auth = Buffer.from(`${companyId}+${publicKey}:${privateKey}`).toString('base64');
const headers = { Authorization: `Basic ${auth}`, clientId, 'Content-Type': 'application/json' };

// Find invoice CW1129
const r = await fetch(`${base}/finance/invoices?conditions=balance>0 and invoiceNumber="CW1129"&fields=id,invoiceNumber,balance,closedFlag&pageSize=1`, { headers });
const data = await r.json();
console.log('Invoice:', JSON.stringify(data[0]));

if (!data[0]) { console.log('Invoice not found'); process.exit(1); }
const id = data[0].id;

// Test 1: without leading slash (current approach)
const t1 = await fetch(`${base}/finance/invoices/${id}`, {
  method: 'PATCH', headers,
  body: JSON.stringify([{ op: 'replace', path: 'closedFlag', value: true }])
});
console.log(`\nTest 1 (path: "closedFlag"): ${t1.status}`, (await t1.text()).slice(0, 200));

// Test 2: with leading slash (RFC 6902)
const t2 = await fetch(`${base}/finance/invoices/${id}`, {
  method: 'PATCH', headers,
  body: JSON.stringify([{ op: 'replace', path: '/closedFlag', value: true }])
});
console.log(`\nTest 2 (path: "/closedFlag"): ${t2.status}`, (await t2.text()).slice(0, 200));

// Test 3: plain object body (not JSON Patch)
const t3 = await fetch(`${base}/finance/invoices/${id}`, {
  method: 'PATCH', headers,
  body: JSON.stringify({ closedFlag: true })
});
console.log(`\nTest 3 (plain {closedFlag: true}): ${t3.status}`, (await t3.text()).slice(0, 200));

// Test 4: GET full invoice then PUT it back with closedFlag=true
const getR = await fetch(`${base}/finance/invoices/${id}`, { headers });
const full = await getR.json();
full.closedFlag = true;
const t4 = await fetch(`${base}/finance/invoices/${id}`, {
  method: 'PUT', headers,
  body: JSON.stringify(full)
});
console.log(`\nTest 4 (PUT full object closedFlag=true): ${t4.status}`, (await t4.text()).slice(0, 300));
