import type { Metadata } from "next";
import { Suspense } from "react";
import TerminalApp from "@/components/terminal/TerminalApp";
import { redirect } from "next/navigation";
import { accessNow, requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Terminal — Screenerix" };

/** The session check: signed-out visitors go to /login (and back here after), expired accounts to /billing. */
async function TerminalGate() {
  const user = await requireUser("/terminal");
  if (accessNow(user).state === "expired") redirect("/billing?expired=1");
  return <TerminalApp user={user} />;
}

export default function TerminalPage() {
  return (
    <Suspense fallback={<div className="sx-root" style={{ minHeight: "100vh", background: "#0B0C0E" }} aria-busy="true" />}>
      <TerminalGate />
    </Suspense>
  );
}
