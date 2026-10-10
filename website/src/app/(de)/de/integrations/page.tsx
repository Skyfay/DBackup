import { IntegrationsPage, integrationsMetadata } from "@/components/pages/integrations-page";

export const metadata = integrationsMetadata("de");

export default function Integrations() {
  return <IntegrationsPage locale="de" />;
}
