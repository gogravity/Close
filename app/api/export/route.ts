import { NextResponse } from "next/server";
import { buildClosePackage } from "@/lib/export";
import { getEntityConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "xlsx";

  try {
    const { workbook, summary } = await buildClosePackage();
    if (format === "summary") {
      return NextResponse.json(summary);
    }
    const buf = await workbook.xlsx.writeBuffer();
    const entity = await getEntityConfig();
    const safeName = (entity.name || "close").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const filename = `${safeName}-close-${summary.asOf}.xlsx`;
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
