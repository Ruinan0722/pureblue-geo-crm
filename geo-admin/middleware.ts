import type { NextRequest } from "next/server"
import { adminMiddleware } from "@/modules/auth/admin-middleware"

export async function middleware(req: NextRequest) {
  return adminMiddleware(req)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
