import LegalPage, { legalMetadata } from "@/components/legal/LegalPage";
import { REFUNDS } from "@/lib/legal/content";

export const metadata = legalMetadata(REFUNDS);

export default function Page() {
  return <LegalPage doc={REFUNDS} />;
}
