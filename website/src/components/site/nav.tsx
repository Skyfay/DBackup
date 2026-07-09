import Link from "next/link";
import Image from "next/image";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { GithubStarsWidget } from "@/components/site/github-stars-widget";
import { DOCS_URL, API_DOCS_URL, GETTING_STARTED_URL } from "@/lib/content";

const NAV_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/blog", label: "Blog" },
  { href: DOCS_URL, label: "Docs", external: true },
  { href: API_DOCS_URL, label: "API", external: true },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.svg" alt="DBackup" width={28} height={28} />
          <span className="font-semibold">DBackup</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noreferrer" : undefined}
              className="transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <GithubStarsWidget />
          <Button asChild size="sm">
            <Link href={GETTING_STARTED_URL} target="_blank" rel="noreferrer">
              Get Started
            </Link>
          </Button>
        </div>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="md:hidden">
              <Menu className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>DBackup</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-4 px-4 text-sm">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  target={link.external ? "_blank" : undefined}
                  rel={link.external ? "noreferrer" : undefined}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
              <GithubStarsWidget />
              <Button asChild size="sm">
                <Link href={GETTING_STARTED_URL} target="_blank" rel="noreferrer">
                  Get Started
                </Link>
              </Button>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
