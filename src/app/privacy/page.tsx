import LegalPage, { legalMetadata } from "@/components/legal/LegalPage";
import { PRIVACY } from "@/lib/legal/content";

export const metadata = legalMetadata(PRIVACY);

export default function Page() {
  return <LegalPage doc={PRIVACY} />;
}
