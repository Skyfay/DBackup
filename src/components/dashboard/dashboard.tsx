"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CloudUpload,
  Database,
  HardDrive,
  PlayCircle,
  Plus,
  ServerCrash,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { backupHealthSnapshot, createBackupTarget, runBackupOnce } from "@/lib/services/backups";
import { createNotificationChannel } from "@/lib/services/notifications";
import { createStorageLocation } from "@/lib/services/storage";
import {
  BackupTarget,
  BackupTargetInput,
  NotificationChannel,
  NotificationChannelInput,
  StorageLocation,
  StorageLocationInput,
} from "@/lib/types";

interface DashboardProps {
  initialBackupTargets: BackupTarget[];
  initialStorageLocations: StorageLocation[];
  initialNotificationChannels: NotificationChannel[];
}

const statusCopy: Record<BackupTarget["status"], { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  healthy: { label: "Healthy", variant: "success" },
  warning: { label: "Needs Attention", variant: "warning" },
  error: { label: "Failed", variant: "destructive" },
  pending: { label: "Scheduled", variant: "secondary" },
};

export function Dashboard({
  initialBackupTargets,
  initialStorageLocations,
  initialNotificationChannels,
}: DashboardProps) {
  const [backupTargets, setBackupTargets] = useState<BackupTarget[]>(
    initialBackupTargets
  );
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>(
    initialStorageLocations
  );
  const [notificationChannels, setNotificationChannels] = useState<NotificationChannel[]>(
    initialNotificationChannels
  );

  const [backupForm, setBackupForm] = useState<BackupTargetInput>({
    name: "",
    engine: "postgres",
    host: "",
    database: "",
    schedule: "0 3 * * *",
    storageLocationId: initialStorageLocations[0]?.id ?? "",
    notificationChannelIds: initialNotificationChannels
      .filter((c) => c.enabled)
      .map((c) => c.id),
    retentionDays: 14,
  });

  const [storageForm, setStorageForm] = useState<StorageLocationInput>({
    name: "",
    type: "s3",
    endpoint: "",
    bucket: "",
    region: "",
    encryption: "aes256",
  });

  const [notificationForm, setNotificationForm] =
    useState<NotificationChannelInput>({
      type: "email",
      target: "",
      description: "",
      enabled: true,
    });

  const summary = useMemo(() => backupHealthSnapshot(backupTargets), [backupTargets]);

  const handleRunBackup = (id: string) => {
    const { next, message } = runBackupOnce(
      backupTargets,
      id,
      storageLocations,
      notificationChannels
    );
    setBackupTargets(next);
    toast.success("Backup gestartet", { description: message });
  };

  const handleCreateBackup = () => {
    if (!backupForm.name || !backupForm.host || !backupForm.database) {
      toast.error("Fehlende Angaben", {
        description: "Name, Host und Datenbank sind Pflichtfelder.",
      });
      return;
    }

    const { next, created } = createBackupTarget(backupTargets, backupForm);
    setBackupTargets(next);
    toast.success("Backup hinzugefügt", {
      description: `${created.name} wird nach Plan ${created.schedule} gefahren.`,
    });
    setBackupForm({
      ...backupForm,
      name: "",
      host: "",
      database: "",
    });
  };

  const handleCreateStorage = () => {
    if (!storageForm.name || !storageForm.endpoint) {
      toast.error("Speicher unvollständig", {
        description: "Name und Endpoint werden benötigt.",
      });
      return;
    }

    const { next, created } = createStorageLocation(storageLocations, storageForm);
    setStorageLocations(next);
    toast.success("Speicher hinzugefügt", {
      description: `${created.name} (${created.type}) kann jetzt genutzt werden.`,
    });
    setBackupForm((prev) => ({ ...prev, storageLocationId: created.id }));
    setStorageForm({ name: "", type: "s3", endpoint: "", bucket: "", region: "", encryption: "aes256" });
  };

  const handleCreateNotification = () => {
    if (!notificationForm.target) {
      toast.error("Ziel fehlt", { description: "Bitte Empfänger oder Webhook angeben." });
      return;
    }

    const { next, created } = createNotificationChannel(
      notificationChannels,
      notificationForm
    );
    setNotificationChannels(next);
    toast.success("Channel hinzugefügt", {
      description: `${created.type.toUpperCase()} → ${created.target}`,
    });
    setNotificationForm({ type: "email", target: "", description: "", enabled: true });
  };

  return (
    <AppShell>
      <div id="overview" className="space-y-6">
        <Hero summary={summary} />
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card id="backups" className="border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Aktive Backups</CardTitle>
                <CardDescription>Steuere Jobs, Storage und Alerts.</CardDescription>
              </div>
              <Button size="sm" onClick={() => handleCreateBackup()}>
                <Plus className="mr-2 h-4 w-4" />
                Backup anlegen
              </Button>
            </CardHeader>
            <CardContent className="grid gap-3">
              {backupTargets.map((backup) => (
                <div
                  key={backup.id}
                  className="flex flex-col gap-3 rounded-lg border bg-card/60 p-4 shadow-sm md:flex-row md:items-center md:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold">{backup.name}</p>
                      <Badge variant={statusCopy[backup.status].variant}>
                        {statusCopy[backup.status].label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {backup.engine.toUpperCase()} · {backup.host} · DB: {backup.database}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Plan: {backup.schedule} · Speicher: {storageLocations.find((s) => s.id === backup.storageLocationId)?.name ?? "unbekannt"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">Retention: {backup.retentionDays}d</Badge>
                    <Badge variant="secondary">Alerts: {backup.notificationChannelIds.length}</Badge>
                    {backup.lastRun && (
                      <Badge variant="outline">Letzter Lauf: {new Date(backup.lastRun).toLocaleString()}</Badge>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => handleRunBackup(backup.id)}>
                      <PlayCircle className="mr-1 h-4 w-4" />
                      Sofort sichern
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4" id="storage">
            <ConfigCard
              title="Neue Datenquelle"
              description="Einfaches Modell: Engine, Speicher, Alerts auswählen."
              icon={<Database className="h-5 w-5 text-primary" />}
            >
              <div className="space-y-3">
                <InputRow label="Name" value={backupForm.name} onChange={(value) => setBackupForm({ ...backupForm, name: value })} />
                <div className="grid grid-cols-2 gap-3">
                  <InputRow
                    label="Engine"
                    component={
                      <Select
                        value={backupForm.engine}
                        onChange={(e) => setBackupForm({ ...backupForm, engine: e.target.value as BackupTargetInput["engine"] })}
                      >
                        <option value="postgres">Postgres</option>
                        <option value="mysql">MySQL</option>
                        <option value="mongo">Mongo</option>
                        <option value="mariadb">MariaDB</option>
                        <option value="sqlserver">SQL Server</option>
                      </Select>
                    }
                  />
                  <InputRow label="Retention (Tage)" value={backupForm.retentionDays.toString()} onChange={(value) => setBackupForm({ ...backupForm, retentionDays: Number(value) })} />
                </div>
                <InputRow label="Host" value={backupForm.host} onChange={(value) => setBackupForm({ ...backupForm, host: value })} placeholder="db.internal:5432" />
                <InputRow label="Database" value={backupForm.database} onChange={(value) => setBackupForm({ ...backupForm, database: value })} />
                <InputRow label="Cron Plan" value={backupForm.schedule} onChange={(value) => setBackupForm({ ...backupForm, schedule: value })} placeholder="0 3 * * *" />
                <InputRow
                  label="Speicher"
                  component={
                    <Select
                      value={backupForm.storageLocationId}
                      onChange={(e) => setBackupForm({ ...backupForm, storageLocationId: e.target.value })}
                    >
                      {storageLocations.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name} ({store.type})
                        </option>
                      ))}
                    </Select>
                  }
                />
                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground">Benachrichtigungen</Label>
                  <div className="grid grid-cols-1 gap-2">
                    {notificationChannels.map((channel) => {
                      const checked = backupForm.notificationChannelIds.includes(channel.id);
                      return (
                        <label
                          key={channel.id}
                          className="flex cursor-pointer items-center justify-between rounded-md border bg-background px-3 py-2 text-sm"
                        >
                          <div className="space-y-0.5">
                            <p className="font-medium">{channel.type.toUpperCase()}</p>
                            <p className="text-xs text-muted-foreground">{channel.target}</p>
                          </div>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...backupForm.notificationChannelIds, channel.id]
                                : backupForm.notificationChannelIds.filter((id) => id !== channel.id);
                              setBackupForm({ ...backupForm, notificationChannelIds: next });
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
                <Button className="w-full" onClick={handleCreateBackup}>
                  <Plus className="mr-2 h-4 w-4" /> Backup speichern
                </Button>
              </div>
            </ConfigCard>

            <ConfigCard
              title="Storage hinzufügen"
              description="S3, GCS, Azure oder lokal."
              icon={<HardDrive className="h-5 w-5 text-primary" />}
            >
              <div className="space-y-3">
                <InputRow label="Name" value={storageForm.name} onChange={(value) => setStorageForm({ ...storageForm, name: value })} />
                <InputRow
                  label="Typ"
                  component={
                    <Select
                      value={storageForm.type}
                      onChange={(e) => setStorageForm({ ...storageForm, type: e.target.value as StorageLocation["type"] })}
                    >
                      <option value="s3">S3</option>
                      <option value="gcs">GCS</option>
                      <option value="azure-blob">Azure Blob</option>
                      <option value="local">Local/NAS</option>
                    </Select>
                  }
                />
                <Textarea
                  placeholder="Endpoint oder Pfad (z.B. s3.amazonaws.com / 10.0.0.42:/mnt/nas/backups)"
                  value={storageForm.endpoint}
                  onChange={(e) => setStorageForm({ ...storageForm, endpoint: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <InputRow label="Bucket/Pfad" value={storageForm.bucket ?? ""} onChange={(value) => setStorageForm({ ...storageForm, bucket: value })} />
                  <InputRow label="Region" value={storageForm.region ?? ""} onChange={(value) => setStorageForm({ ...storageForm, region: value })} />
                </div>
                <Button variant="secondary" className="w-full" onClick={handleCreateStorage}>
                  <CloudUpload className="mr-2 h-4 w-4" /> Speicher speichern
                </Button>
              </div>
            </ConfigCard>

            <ConfigCard
              id="notifications"
              title="Notification Channel"
              description="Discord, E-Mail oder Webhook."
              icon={<Bell className="h-5 w-5 text-primary" />}
            >
              <div className="space-y-3">
                <InputRow
                  label="Typ"
                  component={
                    <Select
                      value={notificationForm.type}
                      onChange={(e) =>
                        setNotificationForm({
                          ...notificationForm,
                          type: e.target.value as NotificationChannel["type"],
                        })
                      }
                    >
                      <option value="email">Email</option>
                      <option value="discord">Discord</option>
                      <option value="webhook">Webhook</option>
                    </Select>
                  }
                />
                <Textarea
                  placeholder="Empfänger oder Webhook URL"
                  value={notificationForm.target}
                  onChange={(e) => setNotificationForm({ ...notificationForm, target: e.target.value })}
                />
                <InputRow
                  label="Beschreibung"
                  value={notificationForm.description ?? ""}
                  onChange={(value) => setNotificationForm({ ...notificationForm, description: value })}
                  placeholder="#db-alerts / On-Call"
                />
                <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm">
                  <span>Aktiv</span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={notificationForm.enabled}
                    onChange={(e) => setNotificationForm({ ...notificationForm, enabled: e.target.checked })}
                  />
                </div>
                <Button variant="outline" className="w-full" onClick={handleCreateNotification}>
                  <Plus className="mr-2 h-4 w-4" /> Channel speichern
                </Button>
              </div>
            </ConfigCard>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Hero({ summary }: { summary: ReturnType<typeof backupHealthSnapshot> }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <StatCard
        icon={<ShieldCheck className="h-5 w-5 text-emerald-600" />}
        title="Gesichert"
        value={`${summary.healthy}/${summary.total}`}
        hint="Letzte Läufe erfolgreich"
      />
      <StatCard
        icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
        title="Warnungen"
        value={summary.warning}
        hint="Verifizierung oder Storage prüfen"
      />
      <StatCard
        icon={<ServerCrash className="h-5 w-5 text-rose-500" />}
        title="Fehler"
        value={summary.error}
        hint="Logs ansehen & Retrys planen"
      />
    </div>
  );
}

function StatCard({
  icon,
  title,
  value,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  value: number | string;
  hint: string;
}) {
  return (
    <Card className="border-muted-foreground/10">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function ConfigCard({
  id,
  title,
  description,
  icon,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className="border-muted/60 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            {icon}
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function InputRow({
  label,
  value,
  onChange,
  placeholder,
  component,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  component?: React.ReactNode;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {component ? (
        component
      ) : (
        <Input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange?.(e.target.value)}
        />
      )}
    </div>
  );
}
