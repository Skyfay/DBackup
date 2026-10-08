"use client";

import { useRef, useState } from "react";
import { Lock } from "lucide-react";
import { SpotlightCard } from "@/components/site/spotlight-card";
import { Glow } from "@/components/site/fx";
import { useTick } from "@/components/site/home/use-tick";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/translate";

const HEX = "0123456789abcdef";

function cipherAt(tick: number) {
  let cs = tick * 7 + 3;
  let out = "";
  for (let h = 0; h < 44; h++) {
    cs = (cs * 1103515245 + 12345) % 2147483648;
    out += HEX[cs % 16];
    if (h % 4 === 3) out += " ";
  }
  return out;
}

export function CipherCard({ className }: { className?: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const tick = useTick(120, ref, 0);

  return (
    <SpotlightCard ref={ref} className={cn("flex flex-col gap-3.5 rounded-[22px] p-6", className)}>
      <Glow color="#34d399" opacity={0.2} blur={60} drift={1} className="-top-20 -right-20 size-60" />
      <span className="relative flex size-11 items-center justify-center rounded-xl bg-tone-green/14 text-tone-green">
        <Lock className="size-[22px]" />
      </span>
      <div className="relative">
        <h3 className="text-lg font-semibold">AES-256-GCM</h3>
        <p className="mt-1.5 leading-[1.55] text-muted-foreground">{t("features.cipherText")}</p>
      </div>
      <div
        aria-hidden="true"
        className="relative mt-auto overflow-hidden rounded-[10px] border border-border bg-background px-3 py-2 font-mono text-xs whitespace-nowrap text-tone-green"
      >
        {cipherAt(tick)}
      </div>
    </SpotlightCard>
  );
}

const SWITCHES: MessageKey[] = ["features.oidc", "features.passkey"];

export function TeamCard({ className }: { className?: string }) {
  const { t } = useI18n();
  const [on, setOn] = useState([true, true]);

  return (
    <SpotlightCard className={cn("flex flex-col gap-3.5 rounded-[22px] p-6", className)}>
      <div className="relative">
        <h3 className="text-lg font-semibold tracking-[-0.02em]">{t("features.teamTitle")}</h3>
        <p className="mt-1.5 text-muted-foreground">{t("features.teamText")}</p>
      </div>
      <div className="relative mt-auto flex flex-col rounded-xl border border-border text-[13px]">
        {SWITCHES.map((label, i) => (
          <button
            key={label}
            type="button"
            role="switch"
            aria-checked={on[i]}
            onClick={() => setOn((prev) => prev.map((v, j) => (j === i ? !v : v)))}
            className="flex w-full items-center justify-between p-3 text-left [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border"
          >
            <span>{t(label)}</span>
            <span
              className={cn(
                "relative h-5 w-[34px] shrink-0 rounded-full transition-colors duration-200",
                on[i] ? "bg-muted-foreground" : "bg-input"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full transition-[left] duration-200",
                  on[i] ? "left-4 bg-card dark:bg-[#18181b]" : "left-0.5 bg-card dark:bg-faint"
                )}
              />
            </span>
          </button>
        ))}
      </div>
    </SpotlightCard>
  );
}
