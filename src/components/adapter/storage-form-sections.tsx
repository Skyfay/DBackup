"use client";

import { useId } from "react";
import { useFormContext } from "react-hook-form";
import { TriangleAlert } from "lucide-react";
import type { AdapterDefinition } from "@/lib/adapters/definitions";
import { STORAGE_ROLES, supportsStorageRole, type StorageRole } from "@/lib/core/storage-roles";
import { CloudFolderField } from "./cloud-folder-field";
import { ConfigField, ConfigSwitches, HostPortFields, LoginField, NameField, isBooleanSchema } from "./connection-form-fields";
import type { SectionId } from "./connection-form-layout";
import { ChoiceCards, ModeChoice, type ModeOption } from "./connection-mode-choice";
import { OAuthAuthorization } from "./oauth-authorization";
import { SwitchList, SwitchRow } from "./setting-switches";
import { SnapshotSwitch } from "./snapshot-switch";
import { SshTestButton } from "./ssh-test-button";
import { isOAuthAdapter, storageReachKeys } from "./storage-form-layout";
import { ParallelTransfersField, ParallelUploadFields } from "./storage-speed-fields";
import type { ConnectionSectionProps } from "./use-connection-form";

/** Names that read better than the ones made from the keys. */
const LABELS: Record<string, string> = {
    basePath: "Folder",
    accountId: "Account ID",
    jurisdiction: "Bucket jurisdiction",
    address: "Share",
    url: "URL",
    socketPath: "Docker socket",
    pathPrefix: "Folder",
    storageClass: "Storage class",
    maxProtocol: "Highest SMB version",
    options: "Extra options",
    helperImage: "Helper image",
};

const DESCRIPTIONS: Record<string, string> = {
    // "Hetzner Region" and the like say nothing the label does not.
    region: "",
    jurisdiction: "Standard, EU or FedRAMP. It has to match where the bucket was created.",
    storageClass: "STANDARD suits most backups. The archive classes cannot be restored through DBackup directly.",
    options: "Passed on to rsync.",
};

const SWITCHES: Record<string, { title: string; description: string }> = {
    forcePathStyle: { title: "Path-style URLs", description: "Needed by MinIO and some other S3 compatible servers." },
    tls: { title: "TLS (FTPS)", description: "Encrypt the connection with FTPS." },
};

const ROLE_OPTIONS: ModeOption[] = [
    { value: STORAGE_ROLES.DESTINATION, title: "Backup destination", description: "Backups are written below its folder, one folder per job." },
    { value: STORAGE_ROLES.SOURCE, title: "Directory source", description: "Jobs back up folders picked below its folder." },
];

function folderNote(role: StorageRole): string {
    return role === STORAGE_ROLES.SOURCE
        ? "Directory sources pick their folders below this one."
        : "Backups go below this folder, one folder per job.";
}

function Field(props: { adapter: AdapterDefinition; fieldKey: string; description?: string }) {
    return <ConfigField {...props} label={LABELS[props.fieldKey]} description={props.description ?? DESCRIPTIONS[props.fieldKey]} />;
}

function modeOptions(adapter: AdapterDefinition): ModeOption[] {
    const docker = adapter.id === "docker-volume";
    return [
        {
            value: "direct",
            title: "Direct",
            description: docker ? "DBackup uses the Docker socket of the machine it runs on." : "DBackup connects to the storage itself.",
        },
        {
            value: "ssh",
            title: "Over SSH",
            description: docker ? "DBackup logs into another machine and uses its Docker." : "DBackup logs into a server and reaches the storage from there.",
            beta: true,
        },
    ];
}

/** Where the storage is, in the order of its schema, with host and port side by side. */
function ReachFields({ adapter, role }: { adapter: AdapterDefinition; role: StorageRole }) {
    const keys = storageReachKeys(adapter);
    return (
        <>
            {keys.map((key) => {
                if (key === "port" && keys.includes("host")) return null;
                if (key === "host" && keys.includes("port")) return <HostPortFields key={key} adapter={adapter} hostKey="host" portKey="port" />;
                return <Field key={key} adapter={adapter} fieldKey={key} description={key === "basePath" ? folderNote(role) : undefined} />;
            })}
        </>
    );
}

function ConnectionPart(props: ConnectionSectionProps) {
    const { adapter, storageRole } = props;
    const { watch } = useFormContext();
    const hasMode = "connectionMode" in (adapter.configSchema.shape as Record<string, unknown>);
    const mode = hasMode ? watch("config.connectionMode") : "direct";
    const oauth = isOAuthAdapter(adapter);

    return (
        <>
            <NameField placeholder="Office NAS" />
            {hasMode && <ModeChoice fieldKey="connectionMode" label="How DBackup connects" options={modeOptions(adapter)} />}
            {mode === "direct" && (
                <>
                    <ReachFields adapter={adapter} role={storageRole} />
                    <LoginField
                        adapter={adapter}
                        slot="primary"
                        value={props.primaryCredentialId}
                        onChange={props.onPrimaryChange}
                        label={oauth ? "OAuth app" : undefined}
                        onSelectedProfile={props.onPrimaryProfile}
                        refreshKey={props.credentialRefreshKey}
                    />
                    {oauth && (
                        <OAuthAuthorization
                            adapterId={adapter.id}
                            credentialId={props.primaryCredentialId ?? undefined}
                            authorized={props.authorized}
                            onAuthorized={props.onAuthorized}
                        />
                    )}
                </>
            )}
        </>
    );
}

function LocationPart(props: ConnectionSectionProps) {
    const { adapter, storageRole } = props;
    const storageClass = useFormContext().watch("config.storageClass");
    const archived = storageClass === "GLACIER" || storageClass === "DEEP_ARCHIVE";

    return (
        <>
            {isOAuthAdapter(adapter) ? (
                <CloudFolderField
                    adapterId={adapter.id}
                    authorized={props.authorized}
                    credentialId={props.primaryCredentialId ?? undefined}
                    description={folderNote(storageRole)}
                />
            ) : (
                <Field adapter={adapter} fieldKey="pathPrefix" description={folderNote(storageRole)} />
            )}
            <Field adapter={adapter} fieldKey="storageClass" />
            {archived && (
                <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    <p>
                        <span className="font-medium">{storageClass === "DEEP_ARCHIVE" ? "Deep Archive" : "Glacier"}</span> is an archive class.
                        DBackup cannot download or restore these backups directly. Restore the objects in the AWS console first, under
                        Actions and Initiate restore.
                    </p>
                </div>
            )}
        </>
    );
}

function OptionsPart({ keys, ...props }: ConnectionSectionProps & { keys: string[] }) {
    const { adapter } = props;
    const { watch, setValue, getValues } = useFormContext();
    const shape = adapter.configSchema.shape as Record<string, unknown>;
    const plain = keys.filter((key) => key !== "useVss");

    return (
        <>
            {plain.filter((key) => !isBooleanSchema(shape[key])).map((key) => <Field key={key} adapter={adapter} fieldKey={key} />)}
            <ConfigSwitches adapter={adapter} keys={plain} copy={SWITCHES} />
            {keys.includes("useVss") && (
                <SnapshotSwitch
                    enabled={watch("config.useVss") === true}
                    onChange={(on) => setValue("config.useVss", on, { shouldDirty: true })}
                    adapterId={adapter.id}
                    getConfig={() => ({
                        config: (getValues("config") ?? {}) as Record<string, unknown>,
                        primaryCredentialId: props.primaryCredentialId,
                        sshCredentialId: props.sshCredentialId,
                    })}
                />
            )}
        </>
    );
}

function SpeedPart({ adapter, storageRole }: ConnectionSectionProps) {
    const { watch, setValue } = useFormContext();
    const set = (key: string, value: number) => setValue(`config.${key}`, value, { shouldDirty: true });

    if (storageRole === STORAGE_ROLES.SOURCE) {
        return <ParallelTransfersField adapterId={adapter.id} value={watch("config.maxConcurrentFiles")} onChange={(value) => set("maxConcurrentFiles", value)} />;
    }
    return (
        <ParallelUploadFields
            adapterId={adapter.id}
            concurrency={watch("config.uploadConcurrency")}
            partSizeMb={watch("config.uploadPartSizeMb")}
            onConcurrencyChange={(value) => set("uploadConcurrency", value)}
            onPartSizeChange={(value) => set("uploadPartSizeMb", value)}
        />
    );
}

function BehaviorPart({ adapter, storageRole, onStorageRoleChange, metadata, onMetadataChange }: ConnectionSectionProps) {
    const labelId = useId();
    const roles = ROLE_OPTIONS.filter((option) => supportsStorageRole(adapter.supportedRoles, option.value as StorageRole));
    const isSource = storageRole === STORAGE_ROLES.SOURCE;

    return (
        <>
            <div className="grid gap-2">
                <p id={labelId} className="text-sm font-medium">Used as</p>
                {roles.length > 1 ? (
                    <ChoiceCards value={storageRole} onValueChange={(value) => onStorageRoleChange(value as StorageRole)} options={roles} aria-labelledby={labelId} />
                ) : (
                    // An adapter that only works one way round is told, not asked. The API refuses the other role anyway.
                    <p className="text-sm text-muted-foreground">
                        {roles[0]?.title} only.
                        {adapter.id === "docker-volume" && " A container runtime is somewhere to read data from, never a place to keep backups."}
                    </p>
                )}
                <p className="text-xs text-muted-foreground">A connection is one or the other, so a job can never back up its own backups.</p>
            </div>
            <SwitchList>
                <SwitchRow
                    title="Health alerts"
                    description={`Notify when this ${isSource ? "source" : "destination"} goes offline or comes back. The checks run either way.`}
                    checked={!metadata.healthNotificationsDisabled}
                    onCheckedChange={(on) => onMetadataChange({ ...metadata, healthNotificationsDisabled: !on })}
                />
                {/* Only a destination holds backups, so only it has any to check. The stored value stays
                    on a source, so switching the role back does not lose it. */}
                {!isSource && (
                    <SwitchRow
                        title="Integrity checks"
                        description="Include this destination in the scheduled integrity check."
                        checked={!metadata.skipVerification}
                        onCheckedChange={(on) => onMetadataChange({ ...metadata, skipVerification: !on })}
                    />
                )}
            </SwitchList>
        </>
    );
}

/** What one part of a storage form shows. */
export function StorageSection({ id, keys, ...props }: ConnectionSectionProps & { id: SectionId; keys: string[] }) {
    const { adapter } = props;
    switch (id) {
        case "connection":
            return <ConnectionPart {...props} />;
        case "ssh":
            return (
                <>
                    <HostPortFields adapter={adapter} hostKey="sshHost" portKey="sshPort" hostLabel="SSH host" />
                    <LoginField adapter={adapter} slot="ssh" value={props.sshCredentialId} onChange={props.onSshChange} />
                </>
            );
        case "service":
            return <ReachFields adapter={adapter} role={props.storageRole} />;
        case "location":
            return <LocationPart {...props} />;
        case "options":
            return <OptionsPart keys={keys} {...props} />;
        case "speed":
            return <SpeedPart {...props} />;
        case "behavior":
            return <BehaviorPart {...props} />;
        default:
            return null;
    }
}

/** The control on the right of a part's heading. */
export function StorageSectionAction({ id, adapter, sshCredentialId }: { id: SectionId; adapter: AdapterDefinition; sshCredentialId: string | null }) {
    if (id !== "ssh") return null;
    return <SshTestButton adapterId={adapter.id} sshCredentialId={sshCredentialId} />;
}
