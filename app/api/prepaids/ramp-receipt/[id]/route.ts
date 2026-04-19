import { NextResponse } from "next/server";
import { fetchReceiptFile, RampError } from "@/lib/ramp";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  try {
    const { buf, contentType } = await fetchReceiptFile(id);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="ramp-receipt-${id}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof RampError) {
      return NextResponse.json(
        { error: err.message, status: err.status, body: err.body },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
