import { NextResponse } from "next/server";
import { getSystemInfo, pingCompanies, ConnectWiseError } from "@/lib/connectwise";
import { listCompanies, BusinessCentralError } from "@/lib/businessCentral";
import { getIntegrationSecrets } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    switch (id) {
      case "connectwise": {
        const [system, reachable] = await Promise.all([getSystemInfo(), pingCompanies()]);
        const hasAgreementModule = system.licenseBits.some(
          (b) => b.name === "Agreement" && b.activeFlag
        );
        const hasGL = system.licenseBits.some(
          (b) => b.name === "GLInterface" && b.activeFlag
        );
        return NextResponse.json({
          ok: true,
          integration: id,
          system: {
            version: system.version,
            isCloud: system.isCloud,
            cloudRegion: system.cloudRegion,
          },
          canListCompanies: reachable > 0,
          modules: { agreements: hasAgreementModule, glInterface: hasGL },
        });
      }
      case "business-central": {
        const [companies, secrets] = await Promise.all([
          listCompanies(),
          getIntegrationSecrets("business-central"),
        ]);
        const entered = secrets.companyName ?? "";
        const match =
          entered &&
          companies.find(
            (c) => c.name === entered || c.displayName === entered || c.id === entered
          );
        return NextResponse.json({
          ok: true,
          integration: id,
          companiesFound: companies.length,
          companies: companies.map((c) => ({
            id: c.id,
            name: c.name,
            displayName: c.displayName,
            systemVersion: c.systemVersion,
          })),
          selectedCompanyMatches: Boolean(match),
          enteredCompanyName: entered,
        });
      }
      default:
        return NextResponse.json(
          { ok: false, error: `No test implemented for integration '${id}'` },
          { status: 501 }
        );
    }
  } catch (err) {
    if (err instanceof ConnectWiseError || err instanceof BusinessCentralError) {
      return NextResponse.json(
        { ok: false, error: err.message, status: err.status, body: err.body },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 200 }
    );
  }
}
