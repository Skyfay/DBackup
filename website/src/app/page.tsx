import { Hero } from "@/components/site/hero";
import { StatsBand } from "@/components/site/stats-band";
import { FeatureGrid } from "@/components/site/feature-grid";
import { NoLockInSection } from "@/components/site/no-lockin-section";
import { AutomationSection } from "@/components/site/automation-section";
import { ProductTour } from "@/components/site/product-tour";
import { Integrations } from "@/components/site/integrations";
import { QuickStart } from "@/components/site/quick-start";
import { Faq } from "@/components/site/faq";
import { BlogTeaser } from "@/components/site/blog-teaser";
import { CtaBand } from "@/components/site/cta-band";

export default function Home() {
  return (
    <>
      <Hero />
      <StatsBand />
      <FeatureGrid />
      <NoLockInSection />
      <AutomationSection />
      <ProductTour />
      <Integrations />
      <QuickStart />
      <Faq />
      <BlogTeaser />
      <CtaBand />
    </>
  );
}
