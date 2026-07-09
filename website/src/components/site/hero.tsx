import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/site/github-icon";
import { TerminalSnippet } from "@/components/site/terminal-snippet";
import { TAGLINE, GITHUB_REPO, GETTING_STARTED_URL } from "@/lib/content";

const HERO_SNIPPET = `$ docker run -d \\
  -p 3000:3000 \\
  -e ENCRYPTION_KEY=$(openssl rand -hex 32) \\
  -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) \\
  -v ./data:/data \\
  skyfay/dbackup:latest`;

export function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 text-center">
      <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
        {TAGLINE}
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
        Standard database dumps, open AES-256-GCM encryption, and a Recovery
        Kit that works with or without DBackup. No vendor lock-in, by design.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg">
          <Link href={GETTING_STARTED_URL} target="_blank" rel="noreferrer">
            Get Started
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href={`https://github.com/${GITHUB_REPO}`} target="_blank" rel="noreferrer">
            <GithubIcon className="size-4" />
            View on GitHub
          </Link>
        </Button>
      </div>

      <TerminalSnippet code={HERO_SNIPPET} className="mx-auto mt-12 max-w-xl text-left" />
    </section>
  );
}
