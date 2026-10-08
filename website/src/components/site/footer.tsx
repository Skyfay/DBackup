import Link from "next/link";
import Image from "next/image";
import {
  DOCS_URL,
  API_DOCS_URL,
  CHANGELOG_URL,
  DISCORD_URL,
  GITHUB_URL,
  SPONSOR_URL,
} from "@/lib/content";
import { DATABASE_NAMES, DATABASE_SLUGS } from "@/lib/integrations";
import { localePath, type Locale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/translate";

interface FooterLink {
  href: string;
  /** A key, or the name of a product, which reads the same in every language. */
  label: { key: MessageKey } | { name: string };
  external?: boolean;
  strong?: boolean;
}

const FOOTER_COLUMNS: { title: MessageKey; links: FooterLink[] }[] = [
  {
    title: "footer.product",
    links: [
      { href: "/#features", label: { key: "footer.features" } },
      { href: "/integrations/", label: { key: "footer.integrations" } },
      { href: "/roadmap/", label: { key: "footer.roadmap" } },
    ],
  },
  {
    // Every page of the site links each database page, so they are never more
    // than one click away.
    title: "footer.databases",
    links: [
      ...DATABASE_SLUGS.map((slug) => ({ href: `/integrations/${slug}/`, label: { name: DATABASE_NAMES[slug] } })),
      { href: "/integrations/", label: { key: "footer.allIntegrations" }, strong: true },
    ],
  },
  {
    title: "footer.resources",
    links: [
      { href: DOCS_URL, label: { key: "footer.documentation" }, external: true },
      { href: API_DOCS_URL, label: { key: "footer.api" }, external: true },
      { href: CHANGELOG_URL, label: { key: "footer.changelog" }, external: true },
    ],
  },
  {
    title: "footer.community",
    links: [
      { href: GITHUB_URL, label: { key: "footer.github" }, external: true },
      { href: DISCORD_URL, label: { key: "footer.discord" }, external: true },
      { href: "/blog/", label: { key: "footer.blog" } },
      { href: SPONSOR_URL, label: { key: "footer.sponsor" }, external: true },
    ],
  },
];

export function Footer({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <footer className="relative mt-28 border-t border-border/70 text-[13px] sm:mt-36">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-6 py-10 grid-cols-2 sm:grid-cols-4 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
        <div className="col-span-2 flex flex-col gap-2.5 sm:col-span-4 lg:col-span-1">
          <Link href={localePath(locale, "/")} className="flex items-center gap-2.5 text-sm font-semibold">
            <Image src="/logo.svg" alt="" width={24} height={24} />
            DBackup
          </Link>
          <span className="text-faint">{t("footer.tagline")}</span>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <div key={column.title} className="flex flex-col gap-2">
            <h2 className="font-medium">{t(column.title)}</h2>
            {column.links.map((link) => (
              <Link
                key={link.href}
                href={link.external ? link.href : localePath(locale, link.href)}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noreferrer" : undefined}
                className={
                  link.strong
                    ? "w-fit font-medium text-foreground"
                    : "w-fit text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                {"key" in link.label ? t(link.label.key) : link.label.name}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </footer>
  );
}
