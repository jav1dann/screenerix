import LandingRoute, { landingMetadata } from "@/components/landing/LandingRoute";

export const metadata = landingMetadata("ru");

/** Landing page in ru (one static route per language; English is `/`). */
export default function Page() {
  return <LandingRoute locale="ru" />;
}
