import { Heart } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SPONSOR_URL } from "@/lib/content";

/** A red heart in the header that leads to GitHub Sponsors. */
export function SponsorButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={SPONSOR_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Sponsor DBackup on GitHub"
          className="group flex size-9 items-center justify-center rounded-lg border border-input bg-secondary transition-colors hover:bg-accent"
        >
          <Heart className="size-4 text-tone-red transition-[fill] group-hover:fill-current" />
        </a>
      </TooltipTrigger>
      <TooltipContent>Sponsor DBackup</TooltipContent>
    </Tooltip>
  );
}
