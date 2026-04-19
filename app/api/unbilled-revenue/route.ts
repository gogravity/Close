import { NextResponse } from "next/server";
import { ConnectWiseError } from "@/lib/connectwise";
import { fetchUnbilledRevenue } from "@/lib/unbilledRevenue";
import { getEntityConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const paramDate = url.searchParams.get("asOf");
  const asOfDate =
    paramDate && /^\d{4}-\d{2}-\d{2}$/.test(paramDate)
      ? paramDate
      : (await getEntityConfig()).periodEnd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    return NextResponse.json(
      { ok: false, error: "asOf date required (YYYY-MM-DD), or set a periodEnd in Settings" },
      { status: 400 }
    );
  }
  try {
    const result = await fetchUnbilledRevenue(asOfDate);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ConnectWiseError) {
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
