"use client";

import { useFormContext } from "react-hook-form";
import type { AdapterDefinition } from "@/lib/adapters/definitions";
import { ConfigField, ConfigSwitches, HostPortFields, LoginField, NameField, isBooleanSchema } from "./connection-form-fields";
import type { SectionId } from "./connection-form-layout";
import { ModeChoice, type ModeOption } from "./connection-mode-choice";
import { sshToolOf } from "./database-form-layout";
import { FirebirdAliasFields } from "./firebird-alias-fields";
import { RedisDatabaseSelect } from "./redis-database-select";
import { SwitchList, SwitchRow } from "./setting-switches";
import { SshTestButton } from "./ssh-test-button";
import type { ConnectionSectionProps } from "./use-connection-form";

/** Names that read better than the ones made from the keys. */
const LABELS: Record<string, string> = {
    authenticationDatabase: "Authentication database",
    firebirdBinaryPath: "gbak binary",
    requestTimeout: "Request timeout (ms)",
    mode: "Redis setup",
    sentinelMasterName: "Sentinel master name",
    sentinelNodes: "Sentinel nodes",
    backupPath: "Backup folder on the server",
    localBackupPath: "The same folder on this machine",
    sqliteBinaryPath: "sqlite3 binary",
};

const DESCRIPTIONS: Record<string, string> = {
    mode: "A single server, or a Sentinel group that points to the current master.",
    localBackupPath: "The server's backup folder as it is mounted here, for example as a Docker volume or an NFS share.",
};

/** Booleans of the database schemas, as sentences that are true when the switch is on. */
const SWITCHES: Record<string, { title: string; description: string }> = {
    tls: { title: "TLS", description: "Encrypt the connection to the server." },
    disableSsl: { title: "Disable SSL", description: "For development databases with a self-signed certificate." },
    encrypt: { title: "Encrypt the connection", description: "Required by Azure SQL and most hosted servers." },
    trustServerCertificate: { title: "Trust the server certificate", description: "Accepts a self-signed certificate, for development servers." },
};

function Field(props: { adapter: AdapterDefinition; fieldKey: string; label?: string; description?: string; sshCredentialId?: string | null }) {
    return <ConfigField {...props} label={props.label ?? LABELS[props.fieldKey]} description={props.description ?? DESCRIPTIONS[props.fieldKey]} />;
}

function modeOptions(adapter: AdapterDefinition): ModeOption[] {
    if (adapter.id === "sqlite") {
        return [
            { value: "local", title: "This machine", description: "The file is on the machine DBackup runs on." },
            { value: "ssh", title: "Over SSH", description: "The file is on a server DBackup logs into.", beta: true },
        ];
    }
    const overSsh = adapter.id === "mssql"
        ? "DBackup reaches SQL Server through a server it logs into."
        : `DBackup logs into the server and runs ${sshToolOf(adapter.id) ?? "the backup"} there.`;
    return [
        { value: "direct", title: "Direct", description: "DBackup connects to the database port." },
        { value: "ssh", title: "Over SSH", description: overSsh, beta: true },
    ];
}

const TRANSFER_OPTIONS: ModeOption[] = [
    { value: "local", title: "Shared folder", description: "The backup folder is mounted here too, for example as a Docker volume." },
    { value: "ssh", title: "Over SSH", description: "DBackup fetches the file from the SQL Server machine." },
];

function PrimaryLogin(props: ConnectionSectionProps) {
    return <LoginField adapter={props.adapter} slot="primary" value={props.primaryCredentialId} onChange={props.onPrimaryChange} />;
}

function SshLogin(props: ConnectionSectionProps) {
    return <LoginField adapter={props.adapter} slot="ssh" value={props.sshCredentialId} onChange={props.onSshChange} />;
}

function ConnectionPart(props: ConnectionSectionProps) {
    const { adapter } = props;
    const { watch } = useFormContext();
    const isSqlite = adapter.id === "sqlite";
    const modeKey = isSqlite ? "mode" : "connectionMode";
    const hasMode = modeKey in (adapter.configSchema.shape as Record<string, unknown>);
    const mode = hasMode ? watch(`config.${modeKey}`) : "direct";

    return (
        <>
            <NameField placeholder="My Production DB" />
            {hasMode && (
                <ModeChoice fieldKey={modeKey} label={isSqlite ? "Where the file is" : "How DBackup connects"} options={modeOptions(adapter)} />
            )}
            {isSqlite && mode === "local" && <Field adapter={adapter} fieldKey="path" label="Database file" />}
            {!isSqlite && mode === "direct" && (
                <>
                    <HostPortFields adapter={adapter} hostKey="host" portKey="port" />
                    <PrimaryLogin {...props} />
                </>
            )}
        </>
    );
}

function TransferPart(props: ConnectionSectionProps) {
    const { adapter } = props;
    const transfer = useFormContext().watch("config.fileTransferMode");
    return (
        <>
            <Field adapter={adapter} fieldKey="backupPath" />
            <ModeChoice fieldKey="fileTransferMode" label="How DBackup gets the file" options={TRANSFER_OPTIONS} />
            {transfer === "local" && <Field adapter={adapter} fieldKey="localBackupPath" />}
            {transfer === "ssh" && (
                <>
                    <HostPortFields adapter={adapter} hostKey="sshHost" portKey="sshPort" hostLabel="SSH host" hostDescription="Leave it empty to use the database host." />
                    <SshLogin {...props} />
                </>
            )}
        </>
    );
}

function OptionsPart({ adapter, keys }: { adapter: AdapterDefinition; keys: string[] }) {
    const shape = adapter.configSchema.shape as Record<string, unknown>;
    const tool = sshToolOf(adapter.id);

    return (
        <>
            {keys.filter((key) => !isBooleanSchema(shape[key])).map((key) => {
                if (key === "database") return <RedisDatabaseSelect key={key} />;
                if (key === "options") {
                    return <Field key={key} adapter={adapter} fieldKey={key} label="Extra options" description={tool ? `Passed on to ${tool}.` : undefined} />;
                }
                if (key === "backupPath") {
                    return <Field key={key} adapter={adapter} fieldKey={key} description="SQL Server writes the backup file here, and it comes back over the SSH connection." />;
                }
                return <Field key={key} adapter={adapter} fieldKey={key} />;
            })}
            <ConfigSwitches adapter={adapter} keys={keys} copy={SWITCHES} />
        </>
    );
}

function BehaviorPart({ metadata, onMetadataChange }: ConnectionSectionProps) {
    return (
        <SwitchList>
            <SwitchRow
                title="Health alerts"
                description="Notify when this database goes offline or comes back. The checks run either way."
                checked={!metadata.healthNotificationsDisabled}
                onCheckedChange={(on) => onMetadataChange({ ...metadata, healthNotificationsDisabled: !on })}
            />
            <SwitchRow
                title="Restore target"
                description="Offer this database as a target when a backup is restored."
                checked={!metadata.isRestoreExcluded}
                onCheckedChange={(on) => onMetadataChange({ ...metadata, isRestoreExcluded: !on })}
            />
        </SwitchList>
    );
}

/** What one part of a database form shows. */
export function DatabaseSection({ id, keys, ...props }: ConnectionSectionProps & { id: SectionId; keys: string[] }) {
    const { adapter } = props;
    const isSqlite = adapter.id === "sqlite";
    switch (id) {
        case "connection":
            return <ConnectionPart {...props} />;
        case "ssh":
            return (
                <>
                    <HostPortFields adapter={adapter} hostKey={isSqlite ? "host" : "sshHost"} portKey={isSqlite ? "port" : "sshPort"} hostLabel="SSH host" />
                    <SshLogin {...props} />
                </>
            );
        case "database":
            return (
                <>
                    <HostPortFields adapter={adapter} hostKey="host" portKey="port" />
                    <PrimaryLogin {...props} />
                </>
            );
        case "file":
            return (
                <>
                    <Field adapter={adapter} fieldKey="path" label="Database file" sshCredentialId={props.sshCredentialId} />
                    <Field adapter={adapter} fieldKey="sqliteBinaryPath" sshCredentialId={props.sshCredentialId} />
                </>
            );
        case "aliases":
            return <FirebirdAliasFields showIntro={false} />;
        case "transfer":
            return <TransferPart {...props} />;
        case "options":
            return <OptionsPart adapter={adapter} keys={keys} />;
        case "behavior":
            return <BehaviorPart {...props} />;
        default:
            return null;
    }
}

/** The control on the right of a part's heading. Only the SSH login can be tested on its own. */
export function DatabaseSectionAction({ id, adapter, sshCredentialId }: { id: SectionId; adapter: AdapterDefinition; sshCredentialId: string | null }) {
    const transfer = useFormContext().watch("config.fileTransferMode");
    if (id === "ssh" || (id === "transfer" && transfer === "ssh")) {
        return <SshTestButton adapterId={adapter.id} sshCredentialId={sshCredentialId} />;
    }
    return null;
}
