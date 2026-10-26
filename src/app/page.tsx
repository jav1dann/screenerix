import LandingRoute, { landingMetadata } from "@/components/landing/LandingRoute";

export const metadata = landingMetadata("en");

/** English landing page (other languages: `app/ru`, `app/tr`, `app/az`). */
export default function Home() {
  return <LandingRoute locale="en" />;
}
