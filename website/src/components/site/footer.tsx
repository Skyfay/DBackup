import Link from "next/link";
import Image from "next/image";
import { DOCS_URL, API_DOCS_URL, DISCORD_URL, GITHUB_REPO } from "@/lib/content";

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/blog", label: "Blog" },
      { href: `https://github.com/${GITHUB_REPO}`, label: "GitHub", external: true },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: DOCS_URL, label: "Documentation", external: true },
      { href: API_DOCS_URL, label: "API Reference", external: true },
      { href: `${DOCS_URL}/changelog`, label: "Changelog", external: true },
      { href: `${DOCS_URL}/roadmap`, label: "Roadmap", external: true },
    ],
  },
  {
    title: "Community",
    links: [
      { href: DISCORD_URL, label: "Discord", external: true },
      { href: `https://github.com/${GITHUB_REPO}/issues`, label: "Issues", external: true },
      { href: "mailto:support@dbackup.app", label: "Support" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <Image src="/logo.svg" alt="DBackup" width={24} height={24} />
              <span className="font-semibold">DBackup</span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Self-hosted database backup automation with encryption,
              compression, and smart retention.
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="text-sm font-semibold">{column.title}</h3>
              <ul className="mt-3 flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noreferrer" : undefined}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>Licensed under GPL-3.0.</p>
          <p>Self-hosted. Open source. No vendor lock-in.</p>
        </div>
      </div>
    </footer>
  );
}
