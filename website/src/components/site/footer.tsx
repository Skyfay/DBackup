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

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#integrations", label: "Integrations" },
      { href: "/roadmap", label: "Roadmap" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: DOCS_URL, label: "Documentation", external: true },
      { href: API_DOCS_URL, label: "API reference", external: true },
      { href: CHANGELOG_URL, label: "Changelog", external: true },
    ],
  },
  {
    title: "Community",
    links: [
      { href: GITHUB_URL, label: "GitHub", external: true },
      { href: DISCORD_URL, label: "Discord", external: true },
      { href: "/blog", label: "Blog" },
      { href: SPONSOR_URL, label: "Sponsor", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-28 border-t border-border/70 text-[13px] sm:mt-36">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-6 py-10 sm:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-2.5 sm:col-span-3 lg:col-span-1">
          <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold">
            <Image src="/logo.svg" alt="" width={24} height={24} />
            DBackup
          </Link>
          <span className="text-faint">Self-hosted backups · GPL-3.0</span>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <div key={column.title} className="flex flex-col gap-2">
            <h2 className="font-medium">{column.title}</h2>
            {column.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noreferrer" : undefined}
                className="w-fit text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </footer>
  );
}
