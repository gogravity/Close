import { NextResponse } from "next/server";
import {
  getAllCompanyStats,
  IronscalesError,
  type IronscalesCompanyStats,
} from "@/lib/ironscales";

export const dynamic = "force-dynamic";

export type IronscalesResponse = {
  ok: true;
  companies: IronscalesCompanyStats[];
  totals: {
    companyCount: number;
    licensedMailboxes: number;
    protectedMailboxes: number;
  };
};

export type IronscalesErrorResponse = {
  ok: false;
  error: string;
};

export async function GET(): Promise<NextResponse> {
  try {
    const companies = await getAllCompanyStats();

    const totals = {
      companyCount:        companies.length,
      licensedMailboxes:   companies.reduce((s, c) => s + c.licensedMailboxes, 0),
      protectedMailboxes:  companies.reduce((s, c) => s + c.protectedMailboxes, 0),
    };

    return NextResponse.json<IronscalesResponse>({ ok: true, companies, totals });
  } catch (err) {
    const msg =
      err instanceof IronscalesError
        ? `Ironscales ${err.status}: ${err.message}`
        : (err as Error).message;
    return NextResponse.json<IronscalesErrorResponse>(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
