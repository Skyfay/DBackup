"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { DOCS_URL } from "@/lib/content";

export const NAV_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#integrations", label: "Integrations" },
  { href: DOCS_URL, label: "Docs", external: true },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/blog", label: "Blog" },
];

export function NavLinks({
  className,
  linkClassName,
}: {
  className?: string;
  linkClassName?: string;
}) {
  const pathname = usePathname().replace(/\/$/, "") || "/";

  return (
    <nav aria-label="Main" className={className}>
      {NAV_LINKS.map((link) => {
        const active = !link.external && !link.href.includes("#") && pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            target={link.external ? "_blank" : undefined}
            rel={link.external ? "noreferrer" : undefined}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-8 items-center rounded-lg px-3 font-medium text-subtle transition-colors hover:bg-foreground/5 hover:text-foreground",
              active && "bg-foreground/10 text-foreground",
              linkClassName
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
