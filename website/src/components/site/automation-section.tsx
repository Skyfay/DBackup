import { Braces, Lock, Server, Workflow } from "lucide-react";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";

const POINTS = [
  {
    icon: Server,
    title: "Direct or SSH",
    description:
      "Connect straight to a database, or run the dump tool on the remote host over SSH - no need to expose database ports to the DBackup server.",
    tags: ["Direct", "SSH Remote Execution"],
  },
  {
    icon: Lock,
    title: "Encrypted by default",
    description:
      "AES-256-GCM encryption with managed Encryption Profiles, key rotation, and a downloadable Recovery Kit for offline decryption.",
    tags: ["AES-256-GCM", "Key Rotation"],
  },
  {
    icon: Braces,
    title: "A full REST API",
    description:
      "Trigger backups, poll executions, manage adapters, and browse storage - with fine-grained, expiring API keys for scripts and pipelines.",
    tags: ["REST API", "API Keys"],
  },
  {
    icon: Workflow,
    title: "Built for CI/CD",
    description:
      "A dedicated skyfay/dbackup:ci image triggers a backup job and waits for it to finish - drop it into any pipeline before a deploy or migration.",
    tags: ["skyfay/dbackup:ci", "GitHub Actions", "GitLab CI"],
  },
];

export function AutomationSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
      <SectionHeading
        eyebrow="Automation"
        title="Fits into how you already run infrastructure"
        description="Two connection modes, encryption on by default, and an API built to be scripted - not just clicked through."
      />

      <Reveal>
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {POINTS.map((point) => (
            <div
              key={point.title}
              className="group relative overflow-hidden rounded-xl border border-border bg-card/50 p-6 transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg"
            >
              <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-40" />
              <div className="relative flex size-11 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/15 transition-transform group-hover:scale-110">
                <point.icon className="size-5 text-primary" />
              </div>
              <h3 className="relative mt-3 text-lg font-semibold tracking-tight">
                {point.title}
              </h3>
              <p className="relative mt-1 text-sm text-muted-foreground">
                {point.description}
              </p>
              <div className="relative mt-4 flex flex-wrap gap-1.5">
                {point.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
