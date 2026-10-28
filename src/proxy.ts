// Every visitor gets an anonymous id (no login), so their portfolio edits,
// rules and feedback are theirs alone. The first request seeds the cookie.
import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "finn_uid";

export function proxy(req: NextRequest) {
  if (req.cookies.get(COOKIE)?.value) return NextResponse.next();
  const id = crypto.randomUUID();
  // Make the id visible to this same request's handlers, then persist it.
  req.cookies.set(COOKIE, id);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set(COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true, secure: req.nextUrl.protocol === "https:" });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/).*)"],
};
