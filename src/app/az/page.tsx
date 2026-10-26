import LandingRoute, { landingMetadata } from "@/components/landing/LandingRoute";

export const metadata = landingMetadata("az");

/** Landing page in az (one static route per language; English is `/`). */
export default function Page() {
  return <LandingRoute locale="az" />;
}
