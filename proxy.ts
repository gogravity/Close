import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Injects the current pathname as `x-pathname` so server components
 * (e.g. DataPrepNav) can read it via headers() and highlight the active link.
 */
export default function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Run on all non-static, non-api routes
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
