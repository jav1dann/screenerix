import LegalPage, { legalMetadata } from "@/components/legal/LegalPage";
import { COOKIES } from "@/lib/legal/content";

export const metadata = legalMetadata(COOKIES);

export default function Page() {
  return <LegalPage doc={COOKIES} />;
}
