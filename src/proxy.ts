import { NextResponse, type NextRequest } from "next/server";
import { isAuthorized } from "@/lib/auth";

// Gate every request behind Basic auth / CRON_SECRET (see src/lib/auth.ts).
// /api/health stays public: it is read-only and the GitHub watchdog polls it.
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();
  if (isAuthorized(request.headers.get("authorization"))) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="stock-research", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest).*)"],
};
