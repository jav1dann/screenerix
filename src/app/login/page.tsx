import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import LoginView from "@/components/landing/LoginView";
import { oauthErrorMessage, safeNext } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/dal";
import { googleConfigured } from "@/lib/auth/google";

export const metadata: Metadata = { title: "Sign in — Screenerix" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Reads the request (query, session), so it streams in behind the boundary. */
async function LoginGate({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  // Already signed in: straight on.
  if (await getCurrentUser()) redirect(next);
  const mode = sp.mode === "register" ? "register" : "signin";
  const oauthError = oauthErrorMessage(Array.isArray(sp.error) ? sp.error[0] : sp.error);
  return <LoginView initialMode={mode} next={next} gated={typeof sp.next === "string" && !oauthError} googleEnabled={googleConfigured()} oauthError={oauthError} />;
}

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<main className="lx-root" style={{ minHeight: "100vh" }} />}>
      <LoginGate searchParams={searchParams} />
    </Suspense>
  );
}
