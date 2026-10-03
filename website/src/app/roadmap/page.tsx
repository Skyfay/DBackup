import { PageBackdrop } from "@/components/site/blog/page-backdrop";
import { Eyebrow, Glow } from "@/components/site/fx";
import { NowSection } from "@/components/site/roadmap/now-section";
import { RoadmapTimeline } from "@/components/site/roadmap/timeline";

export const metadata = {
  title: "Roadmap",
  description:
    "What shipped, what is being built and what is on the wishlist for DBackup. No promised dates, just an honest status.",
  alternates: {
    canonical: "/roadmap",
  },
};

export default function RoadmapPage() {
  return (
    <div className="relative">
      <PageBackdrop />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[1300px] bottom-0 overflow-hidden">
        <Glow color="#059669" opacity={0.08} blur={140} drift={1} className="top-0 left-[4%] h-[640px] w-[520px]" style={{ animationDelay: "-5s" }} />
        <Glow color="#7c3aed" opacity={0.08} blur={140} drift={1} className="top-[200px] right-[4%] h-[640px] w-[520px]" style={{ animationDelay: "-11s" }} />
      </div>

      <section className="relative z-[2] mx-auto flex max-w-[1248px] flex-col items-center gap-5 px-6 pt-[132px] text-center sm:pt-[164px]">
        <Eyebrow>Roadmap</Eyebrow>
        <h1 className="text-[40px] leading-[1.04] font-semibold tracking-[-0.045em] sm:text-[64px]">
          From what shipped
          <br />
          <span className="fx-shine">to what comes next.</span>
        </h1>
        <p className="max-w-[640px] text-lg leading-relaxed text-muted-foreground">
          One line through DBackup&apos;s releases and plans. Looking back on the left, ahead on the right. No
          promised dates, just an honest status.
        </p>
      </section>

      <NowSection />
      <RoadmapTimeline />
    </div>
  );
}
