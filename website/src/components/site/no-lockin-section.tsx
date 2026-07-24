import { ShieldCheck, FileKey, LockOpen, Archive } from "lucide-react";
import Link from "next/link";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";

const POINTS = [
  {
    icon: FileKey,
    title: "Standard dumps",
    description:
      "Every database backup is exactly what pg_dump, mysqldump, or mongodump would produce on their own - no proprietary container format.",
  },
  {
    icon: Archive,
    title: "Archives, not a repository",
    description:
      "File backups are plain TAR archives. Unencrypted, tar -xf is enough; encrypted, the layout is specified byte by byte and one script reads it.",
  },
  {
    icon: ShieldCheck,
    title: "Open encryption",
    description:
      "AES-256-GCM, a documented standard implemented in every major language - not a custom cipher tied to DBackup.",
  },
  {
    icon: LockOpen,
    title: "Recovery Kit",
    description:
      "A downloadable ZIP with your key and standalone Node.js scripts that decrypt backups and extract single files without DBackup running at all.",
  },
];

export function NoLockInSection() {
  return (
    <section className="border-y border-border/60 bg-card/40 dark:border-transparent dark:bg-card/20">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <SectionHeading
          eyebrow="No lock-in"
          title="No vendor lock-in, by design"
          description="If DBackup is ever unavailable, your backups still aren't stuck. Decrypt and restore with a single script and the key from your Recovery Kit."
        />

        <Reveal>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {POINTS.map((point) => (
              <div key={point.title} className="text-center sm:text-left">
                <point.icon className="mx-auto size-6 text-primary sm:mx-0" />
                <h3 className="mt-3 font-semibold">{point.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {point.description}
                </p>
              </div>
            ))}
          </div>

          <p className="mx-auto mt-12 max-w-3xl text-center text-sm text-muted-foreground">
            The promise costs something, and we would rather name the price than
            hide it: incremental backups store whole changed files instead of
            deduplicated chunks, so DBackup uses more storage than restic or
            Borg on the same data. A chunk store is the more efficient design -
            it is also the one that turns a backup into a repository only its
            own tool can open.{" "}
            <Link
              href="/blog/no-global-deduplication"
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
            >
              Why we made that trade
            </Link>
            .
          </p>
        </Reveal>
      </div>
    </section>
  );
}
