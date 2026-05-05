import { NextResponse } from "next/server";
import { isKeyVaultEnabled, getVaultSecret } from "@/lib/keyVault";
import { integrations, resolveVaultSecretName } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET() {
  const kvEnabled = isKeyVaultEnabled();
  const kvUrl = process.env.AZURE_KEY_VAULT_URL ?? process.env.AZURE_KEY_VAULT_NAME ?? "(not set)";

  const results: Record<string, { secretName: string; found: boolean; error?: string }[]> = {};

  if (kvEnabled) {
    for (const integ of integrations) {
      results[integ.id] = await Promise.all(
        integ.fields.map(async (f) => {
          const secretName = resolveVaultSecretName(integ, f);
          try {
            const val = await getVaultSecret(secretName);
            return { secretName, found: Boolean(val) };
          } catch (err) {
            return { secretName, found: false, error: (err as Error).message };
          }
        })
      );
    }
  }

  return NextResponse.json({
    keyVaultEnabled: kvEnabled,
    keyVaultUrl: kvUrl,
    secrets: results,
  });
}
