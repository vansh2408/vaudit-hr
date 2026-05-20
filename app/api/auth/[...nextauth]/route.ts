/**
 * NextAuth v5 catch-all route handler.
 *
 * `handlers` from NextAuth is `Record<"GET" | "POST", (req) => Promise<Response>>`.
 * Re-export its members directly so Next.js App Router picks them up.
 */
import { handlers } from "@/lib/auth/config";

export const GET = handlers.GET;
export const POST = handlers.POST;
