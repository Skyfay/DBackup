import { IntegrationsPage, integrationsMetadata } from "@/components/pages/integrations-page";

export const metadata = integrationsMetadata("en");

export default function Integrations() {
  return <IntegrationsPage locale="en" />;
}
