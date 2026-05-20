import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

/**
 * Root entry. Server-side decides where you belong based on session.
 */
export default async function HomePage(): Promise<never> {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }
  redirect("/login");
}
