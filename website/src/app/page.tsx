import { Hero } from "@/components/site/hero";
import { StatsBand } from "@/components/site/stats-band";
import { ProductTour } from "@/components/site/product-tour";
import { FeatureGrid } from "@/components/site/feature-grid";
import { NoLockInSection } from "@/components/site/no-lockin-section";
import { AutomationSection } from "@/components/site/automation-section";
import { Integrations } from "@/components/site/integrations";
import { QuickStart } from "@/components/site/quick-start";
import { Faq } from "@/components/site/faq";
import { BlogTeaser } from "@/components/site/blog-teaser";
import { CtaBand } from "@/components/site/cta-band";
import { JsonLd } from "@/components/site/json-ld";
import { SITE_URL } from "@/lib/site";
import { TAGLINE } from "@/lib/content";

const SOFTWARE_APPLICATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "DBackup",
  description: TAGLINE,
  url: SITE_URL,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Linux, Docker",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

export default function Home() {
  return (
    <>
      <JsonLd data={SOFTWARE_APPLICATION_JSON_LD} />
      <Hero />
      <StatsBand />
      <Integrations />
      <ProductTour />
      <AutomationSection />
      <FeatureGrid />
      <NoLockInSection />
      <QuickStart />
      <Faq />
      <BlogTeaser />
      <CtaBand />
    </>
  );
}
