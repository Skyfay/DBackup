"use client";

import { CircleDashed, Download, Eye, KeyRound, Lock, LockKeyhole, Package, PackageX, Plug, TriangleAlert } from "lucide-react";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { CREDENTIAL_TYPE_INFO } from "@/components/settings/credential-types";
import type { VaultCredentialsModel, VaultKeysModel } from "@/services/vault/vault-types";
import { count, namesOf } from "./vault-format";

/** "Offsite S3 and 2 more". */
function listed(names: string[]): string {
    const { text, more } = namesOf(names, 1);
    return more > 0 ? `${text} and ${more} more` : text;
}

/** The numbers above the credential profiles. */
export function CredentialsStrip({ model }: { model: VaultCredentialsModel | null }) {
    const stats = model?.stats;
    const attention = model?.profiles.filter((profile) => profile.attention) ?? [];
    return (
        <ExplorerStrip joined
            cells={[
                {
                    label: "Profiles",
                    icon: LockKeyhole,
                    value: stats ? stats.profiles.toLocaleString() : "-",
                    extra: stats?.topKind ? `${count(stats.kinds, "kind")}, most ${CREDENTIAL_TYPE_INFO[stats.topKind].title}` : "none yet",
                },
                { label: "In use", icon: Plug, value: stats ? stats.inUse.toLocaleString() : "-", extra: stats ? `by ${count(stats.connections, "connection")}` : " " },
                { label: "Unused", icon: CircleDashed, value: stats ? stats.unused.toLocaleString() : "-", extra: "no connection logs in with them" },
                {
                    label: "Need a look",
                    icon: TriangleAlert,
                    value: model ? attention.length.toLocaleString() : "-",
                    tone: attention.length > 0 ? "warning" : undefined,
                    extra: attention.length > 0 ? listed(attention.map((profile) => profile.name)) : "every profile can log in",
                },
                {
                    label: "Revealed",
                    icon: Eye,
                    value: stats ? stats.revealed.toLocaleString() : "-",
                    extra: stats?.lastReveal
                        ? <>in 30 days, the last <RelativeTime date={stats.lastReveal.at} />{stats.lastReveal.by && ` by ${stats.lastReveal.by}`}</>
                        : "no secret shown in 30 days",
                },
            ]}
        />
    );
}

/** The numbers above the encryption keys. */
export function KeysStrip({ model }: { model: VaultKeysModel | null }) {
    const stats = model?.stats;
    const configBackup = model?.keys.some((key) => key.configBackup) ?? false;
    const users = stats ? [...(stats.jobs > 0 ? [count(stats.jobs, "job")] : []), ...(configBackup ? ["the config backup"] : [])] : [];
    const clear = stats ? stats.backups - stats.encrypted : 0;
    return (
        <ExplorerStrip joined
            cells={[
                {
                    label: "Keys",
                    icon: KeyRound,
                    value: stats ? stats.keys.toLocaleString() : "-",
                    extra: users.length > 0 ? `${stats?.keysInUse} in use, by ${users.join(" and ")}` : "no job encrypts yet",
                },
                {
                    label: "Encrypted backups",
                    icon: Lock,
                    value: stats ? stats.encrypted.toLocaleString() : "-",
                    extra: stats && stats.backups > 0 ? `of ${stats.backups.toLocaleString()}, ${clear.toLocaleString()} in the clear` : "no backups listed yet",
                },
                {
                    label: "Missing key",
                    icon: PackageX,
                    value: stats ? stats.missing.count.toLocaleString() : "-",
                    tone: stats && stats.missing.count > 0 ? "warning" : undefined,
                    extra: stats && stats.missing.count > 0
                        ? `${stats.missing.count === 1 ? "backup names" : "backups name"} ${stats.missing.keys === 1 ? "a key" : `${stats.missing.keys} keys`} the Vault lacks`
                        : "every backup has its key",
                },
                {
                    label: "Never in a kit",
                    icon: Package,
                    value: stats ? stats.neverInKit.length.toLocaleString() : "-",
                    tone: stats && stats.neverInKit.length > 0 ? "warning" : undefined,
                    extra: stats && stats.neverInKit.length > 0 ? listed(stats.neverInKit) : "every key is in a kit",
                },
                {
                    label: "Last kit",
                    icon: Download,
                    value: stats?.lastKit ? <RelativeTime date={stats.lastKit.at} /> : "-",
                    extra: stats?.lastKit
                        ? [stats.lastKit.by && `by ${stats.lastKit.by}`, stats.lastKit.keys && `with ${count(stats.lastKit.keys, "key")}`].filter(Boolean).join(", ") || "downloaded"
                        : "no kit downloaded yet",
                },
            ]}
        />
    );
}
