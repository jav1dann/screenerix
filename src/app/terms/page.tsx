import LegalPage, { legalMetadata } from "@/components/legal/LegalPage";
import { TERMS } from "@/lib/legal/content";

export const metadata = legalMetadata(TERMS);

export default function Page() {
  return <LegalPage doc={TERMS} />;
}
