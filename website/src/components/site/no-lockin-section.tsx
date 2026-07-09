import { ShieldCheck, FileKey, LockOpen } from "lucide-react";

const POINTS = [
  {
    icon: FileKey,
    title: "Standard dumps",
    description:
      "Every backup is exactly what pg_dump, mysqldump, or mongodump would produce on their own - no proprietary container format.",
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
      "A downloadable ZIP with your key and a standalone Node.js script that decrypts backups without DBackup running at all.",
  },
];

export function NoLockInSection() {
  return (
    <section className="border-y border-border/60 bg-card/40">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            No vendor lock-in, by design
          </h2>
          <p className="mt-3 text-muted-foreground">
            If DBackup is ever unavailable, your backups still aren&apos;t
            stuck. Decrypt and restore with a single script and the key from
            your Recovery Kit.
          </p>
        </div>

        <div className="mt-12 grid gap-8 sm:grid-cols-3">
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
      </div>
    </section>
  );
}
