import Link from "next/link";
import Image from "next/image";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { GithubStarsWidget } from "@/components/site/github-stars-widget";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { NavLinks } from "@/components/site/nav-links";

// The header floats over the top of every page as a glass pill, so each
// page starts its first section with room for it (pt-[172px] on the hero).
export function Nav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 px-4 pt-3 sm:pt-5">
      <div className="glass pointer-events-auto mx-auto flex h-14 max-w-[1100px] items-center gap-5 rounded-[14px] pr-2.5 pl-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 font-semibold">
          <Image src="/logo.svg" alt="" width={26} height={26} />
          DBackup
        </Link>

        <NavLinks className="hidden gap-0.5 lg:flex" />

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <GithubStarsWidget className="hidden sm:flex" />
          <Link
            href="/#start"
            className="fx-btn hidden h-9 items-center rounded-lg bg-primary px-3.5 font-medium text-primary-foreground sm:flex"
          >
            Get started
          </Link>

          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Open menu"
                className="flex size-9 items-center justify-center rounded-lg border border-input bg-secondary lg:hidden"
              >
                <Menu className="size-4" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="bg-background">
              <SheetHeader>
                <SheetTitle>DBackup</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-4 px-4">
                <NavLinks className="flex flex-col gap-1" linkClassName="h-10 text-[15px]" />
                <GithubStarsWidget className="flex w-fit" />
                <Link
                  href="/#start"
                  className="flex h-10 items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground"
                >
                  Get started
                </Link>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
