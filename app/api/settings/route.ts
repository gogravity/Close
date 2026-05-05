import { NextResponse } from "next/server";
import { getSettingsSnapshot, updateSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getSettingsSnapshot();
  return NextResponse.json(snapshot);
}

export async function POST(request: Request) {
  const body = await request.json();
  try {
    await updateSettings(body);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
  const snapshot = await getSettingsSnapshot();
  return NextResponse.json(snapshot);
}
