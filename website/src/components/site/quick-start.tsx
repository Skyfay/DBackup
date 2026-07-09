import Link from "next/link";
import { TerminalSnippet } from "@/components/site/terminal-snippet";
import { QUICK_START_SNIPPET, GETTING_STARTED_URL } from "@/lib/content";

export function QuickStart() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight">Quick start</h2>
        <p className="mt-3 text-muted-foreground">
          Save this as docker-compose.yml, generate two secrets, and run
          docker-compose up -d.
        </p>
      </div>

      <TerminalSnippet code={QUICK_START_SNIPPET} className="mt-10" />

      <p className="mt-4 text-center text-sm text-muted-foreground">
        <Link
          href={GETTING_STARTED_URL}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Read the full installation guide
        </Link>
      </p>
    </section>
  );
}
