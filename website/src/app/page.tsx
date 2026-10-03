import { Hero } from "@/components/site/home/hero";
import { Features } from "@/components/site/home/features";
import { CtaBand, LockInBand } from "@/components/site/home/bands";
import { QuickStart } from "@/components/site/home/quick-start";
import { Faq } from "@/components/site/home/faq";
import { JsonLd } from "@/components/site/json-ld";
import { SITE_URL } from "@/lib/site";
import { FAQS, TAGLINE } from "@/lib/content";

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

export const metadata = {
  alternates: {
    canonical: "/",
  },
};

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
