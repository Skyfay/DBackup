"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { GITHUB_REPO } from "@/lib/content";

const CACHE_KEY = "dbackup-gh-stars";
const CACHE_TTL_MS = 10 * 60 * 1000;

type State =
  | { status: "loading" }
  | { status: "ready"; stars: number }
  | { status: "error" };

export function GithubStarsWidget() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const { stars, ts } = JSON.parse(cached) as { stars: number; ts: number };
        if (Date.now() - ts < CACHE_TTL_MS) {
          setState({ status: "ready", stars });
          return;
        }
      }
    } catch {
      // sessionStorage unavailable - fall through to fetch
    }

    let cancelled = false;
    fetch(`https://api.github.com/repos/${GITHUB_REPO}`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((data: { stargazers_count: number }) => {
        if (cancelled) return;
        setState({ status: "ready", stars: data.stargazers_count });
        try {
          sessionStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ stars: data.stargazers_count, ts: Date.now() })
          );
        } catch {
          // sessionStorage unavailable - skip caching
        }
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
      href={`https://github.com/${GITHUB_REPO}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
    >
      <Star className="size-3.5" />
      Star on GitHub
      {state.status === "ready" && (
        <span className="text-muted-foreground">
          {new Intl.NumberFormat("en", { notation: "compact" }).format(state.stars)}
        </span>
      )}
    </a>
  );
}
