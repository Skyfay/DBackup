"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FaqList } from "@/components/site/faq-list";
import { DISCORD_URL, FAQ_KEYS } from "@/lib/content";
import { DATABASE_SLUGS } from "@/lib/integrations";
import { useI18n } from "@/i18n/provider";

export function Faq() {
  const { t, path } = useI18n();
  // The answer on the supported databases links every engine with a page of
  // its own, and the page of all integrations.
  const link = (href: string) =>
    function FaqLink(chunks: ReactNode) {
      return (
        <Link
          href={path(href)}
          className="text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground"
        >
          {chunks}
        </Link>
      );
    };
  const tags = Object.fromEntries([
    ...DATABASE_SLUGS.map((slug) => [slug, link(`/integrations/${slug}/`)]),
    ["all", link("/integrations/")],
  ]);
  const items = FAQ_KEYS.map((faq) => ({ q: t(faq.q), a: t.rich(faq.a, tags) }));

  return (
    <section id="faq" className="mx-auto grid max-w-[1248px] gap-10 px-6 pt-28 sm:pt-[140px] lg:grid-cols-[4fr_7fr] lg:gap-16">
      <div>
        <h2 className="text-[34px] leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[48px]">{t("faq.title")}</h2>
        <p className="mt-2.5 text-muted-foreground">
          {t.rich("faq.ask", {
            link: (c) => (
              <a href={DISCORD_URL} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
                {c}
              </a>
            ),
          })}
        </p>
      </div>
      <FaqList items={items} idPrefix="faq" />
    </section>
  );
}
