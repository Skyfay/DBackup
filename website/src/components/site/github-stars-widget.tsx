"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { fetchWithCache } from "@/lib/github";
import { GITHUB_URL, GITHUB_REPO } from "@/lib/content";
import { cn } from "@/lib/utils";

const CACHE_KEY = "dbackup-gh-stars";
const CACHE_TTL_MS = 10 * 60 * 1000;

type State =
  | { status: "loading" }
  | { status: "ready"; stars: number }
  | { status: "error" };

export function GithubStarsWidget({ className }: { className?: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchWithCache<{ stargazers_count: number }>(
      CACHE_KEY,
      `https://api.github.com/repos/${GITHUB_REPO}`,
      CACHE_TTL_MS
    )
      .then((data) => {
        if (!cancelled) setState({ status: "ready", stars: data.stargazers_count });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Star DBackup on GitHub"
      className={cn(
        "h-9 items-center gap-1.5 rounded-lg border border-input bg-secondary px-3 font-medium transition-colors hover:bg-accent",
        className
      )}
    >
      <Star className="size-4" />
      <span className="font-normal text-muted-foreground tabular-nums">
        {state.status === "ready"
          ? new Intl.NumberFormat("en", { notation: "compact" }).format(state.stars)
          : "Star"}
      </span>
    </a>
  );
}
