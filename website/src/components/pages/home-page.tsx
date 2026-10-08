import { Hero } from "@/components/site/home/hero";
import { Features } from "@/components/site/home/features";
import { CtaBand, LockInBand } from "@/components/site/home/bands";
import { QuickStart } from "@/components/site/home/quick-start";
import { Faq } from "@/components/site/home/faq";
import { JsonLd } from "@/components/site/json-ld";
import { localePath, type Locale } from "@/i18n/config";
import { createTranslator, stripTags } from "@/i18n/translate";
import { DATABASES, DOCS_URL, FAQ_KEYS, GITHUB_URL, adapterLabel } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

export function homeMetadata(locale: Locale) {
  return pageMetadata(locale, "/");
}

export function HomePage({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);

  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "DBackup",
    description: t("meta.description"),
    url: `${SITE_URL}${localePath(locale, "/")}`,
    inLanguage: locale,
    applicationCategory: "UtilitiesApplication",
    applicationSubCategory: "Backup software",
    operatingSystem: "Linux, Docker",
    softwareRequirements: "Docker",
    license: "https://www.gnu.org/licenses/gpl-3.0.html",
    isAccessibleForFree: true,
    image: `${SITE_URL}${localePath(locale, "/og.png")}`,
    screenshot: `${SITE_URL}/screenshots/dashboard.png`,
    featureList: [
      ...DATABASES.map((db) => t("home.featureDatabase", { name: adapterLabel(db, t) })),
      t("home.featureFiles"),
      t("home.featureEncryption"),
      t("home.featureRetention"),
      t("home.featureRecovery"),
    ],
    sameAs: [GITHUB_URL, DOCS_URL],
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: locale,
    mainEntity: FAQ_KEYS.map((faq) => ({
      "@type": "Question",
      name: t(faq.q),
      acceptedAnswer: { "@type": "Answer", text: stripTags(t(faq.a)) },
    })),
  };

  return (
    <>
      <JsonLd data={softwareJsonLd} />
      <JsonLd data={faqJsonLd} />
      <Hero locale={locale} />
      <Features locale={locale} />
      <LockInBand locale={locale} />
      <QuickStart />
      <Faq />
      <CtaBand locale={locale} />
    </>
  );
}
