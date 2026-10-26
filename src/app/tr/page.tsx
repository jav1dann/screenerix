import LandingRoute, { landingMetadata } from "@/components/landing/LandingRoute";

export const metadata = landingMetadata("tr");

/** Landing page in tr (one static route per language; English is `/`). */
export default function Page() {
  return <LandingRoute locale="tr" />;
}
