import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import path from "node:path";

const KEY_FILE = path.join(process.cwd(), ".data", "master.key");
const ALG = "aes-256-gcm";

let cachedKey: Buffer | null = null;

async function loadOrCreateMasterKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;

  // Prefer the env var — keeps the key off disk in production (Azure Container
  // App secret). Falls back to the key file for local development.
  const envKey = process.env.MASTER_KEY?.trim();
  if (envKey && envKey.length === 64) {
    cachedKey = Buffer.from(envKey, "hex");
    return cachedKey;
  }

  try {
    const hex = (await readFile(KEY_FILE, "utf8")).trim();
    if (hex.length === 64) {
      cachedKey = Buffer.from(hex, "hex");
      return cachedKey;
    }
  } catch {
    // fall through to create
  }
  const key = randomBytes(32);
  await mkdir(path.dirname(KEY_FILE), { recursive: true });
  await writeFile(KEY_FILE, key.toString("hex"), { mode: 0o600 });
  await chmod(KEY_FILE, 0o600).catch(() => {});
  cachedKey = key;
  return key;
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await loadOrCreateMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export async function decrypt(blob: string): Promise<string> {
  const [version, ivB64, tagB64, ctB64] = blob.split(":");
  if (version !== "v1") throw new Error("unknown ciphertext version");
  const key = await loadOrCreateMasterKey();
  const decipher = createDecipheriv(ALG, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

export function maskSecret(plaintext: string): string {
  if (!plaintext) return "";
  if (plaintext.length <= 8) return "•".repeat(plaintext.length);
  return "•".repeat(plaintext.length - 4) + plaintext.slice(-4);
}
