import { Hero } from "@/components/site/home/hero";
import { Features } from "@/components/site/home/features";
import { CtaBand, LockInBand } from "@/components/site/home/bands";
import { QuickStart } from "@/components/site/home/quick-start";
import { Faq } from "@/components/site/home/faq";
import { JsonLd } from "@/components/site/json-ld";
import { SITE_URL } from "@/lib/site";
import { DATABASES, DOCS_URL, FAQS, GITHUB_URL, META_DESCRIPTION } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";

const SOFTWARE_APPLICATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "DBackup",
  description: META_DESCRIPTION,
  url: SITE_URL,
  applicationCategory: "UtilitiesApplication",
  applicationSubCategory: "Backup software",
  operatingSystem: "Linux, Docker",
  softwareRequirements: "Docker",
  license: "https://www.gnu.org/licenses/gpl-3.0.html",
  isAccessibleForFree: true,
  image: `${SITE_URL}/og.png`,
  screenshot: `${SITE_URL}/screenshots/dashboard.png`,
  featureList: [
    ...DATABASES.map((db) => `${db.label} backups`),
    "File and folder backups",
    "AES-256-GCM encryption",
    "Compression and smart retention",
    "Restore without DBackup through the Recovery Kit",
  ],
  sameAs: [GITHUB_URL, DOCS_URL],
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
};

export const metadata = pageMetadata("/");

export default function Home() {
  return (
    <>
      <JsonLd data={SOFTWARE_APPLICATION_JSON_LD} />
      <JsonLd data={FAQ_JSON_LD} />
      <Hero />
      <Features />
      <LockInBand />
      <QuickStart />
      <Faq />
      <CtaBand />
    </>
  );
}
