"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Plus } from "lucide-react";
import { toast } from "sonner";
import { saveViewLayout } from "@/app/actions/auth/table-preferences";
import { ApiTriggerDialog } from "@/components/dashboard/jobs/api-trigger-dialog";
import type { JobActionHandlers } from "@/components/dashboard/jobs/job-actions";
import { jobBulkActions } from "@/components/dashboard/jobs/job-bulk-actions";
import { JobCard } from "@/components/dashboard/jobs/job-card";
import { jobColumns } from "@/components/dashboard/jobs/job-columns";
import { JobDeleteDialog } from "@/components/dashboard/jobs/job-delete-dialog";
import { JobDetailsSheet } from "@/components/dashboard/jobs/job-details-sheet";
import { JobFilterTabs } from "@/components/dashboard/jobs/job-filter-tabs";
import { JobForm } from "@/components/dashboard/jobs/job-form";
import type { AdapterOption, EncryptionOption } from "@/components/dashboard/jobs/job-form-schema";
import { JobContextMenu, JobRowActions } from "@/components/dashboard/jobs/job-menus";
import { matchesJobFilter, type JobFilter } from "@/components/dashboard/jobs/job-status";
import { JOBS_PAGE_ID, JOBS_TABLE_ID } from "@/components/dashboard/jobs/job-tables";
import { useJobList } from "@/components/dashboard/jobs/use-job-list";
import { useRunJob } from "@/components/dashboard/widgets/use-run-job";
import { Button } from "@/components/ui/button";
import { CloneDialog } from "@/components/ui/clone-dialog";
import { DIALOG_SURFACE } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewSwitch } from "@/components/ui/view-switch";
import { useIsMobileState } from "@/hooks/use-mobile";
import { useTableLayout } from "@/hooks/use-table-layout";
import { requestBulk } from "@/lib/bulk-request";
import type { TablePreferences, ViewMode } from "@/lib/core/table-preferences";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { cn } from "@/lib/utils";
import type { JobListItem } from "@/services/jobs/job-list-service";

interface JobsClientProps {
    canManage: boolean;
    canExecute: boolean;
    canViewHistory: boolean;
    canViewStorage: boolean;
    sources: AdapterOption[];
    destinations: AdapterOption[];
    notificationChannels: AdapterOption[];
    encryptionProfiles: EncryptionOption[];
    /** The column layout this user saved, null for the defaults. */
    initialLayout: TablePreferences | null;
    /** The view this user picked last. */
    initialView: ViewMode;
}

/** The views the Jobs page offers. A third one, around the coming runs, is still to be designed. */
const VIEWS: ViewMode[] = ["table", "cards"];

function LoadingList() {
    return (
        <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm" aria-busy="true">
            <span className="sr-only">Loading jobs</span>
            <div className="flex gap-2">
                <Skeleton className="h-8 w-60" />
                <Skeleton className="h-8 w-24" />
            </div>
            {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
            ))}
        </div>
    );
}

function NoJobs({ onCreate }: { onCreate?: () => void }) {
    return (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-14 text-center">
            <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <CalendarClock className="size-5 text-muted-foreground" />
            </span>
            <div className="space-y-1">
                <p className="font-medium">No backup jobs yet</p>
                <p className="text-sm text-muted-foreground">A job backs up a database or folders on a schedule and keeps the backups where you say.</p>
            </div>
            {onCreate && (
                <Button tone="create" onClick={onCreate}>
                    <Plus />
                    New job
                </Button>
            )}
        </div>
    );
}

export function JobsClient({
    canManage, canExecute, canViewHistory, canViewStorage, sources, destinations, notificationChannels, encryptionProfiles, initialLayout, initialView,
}: JobsClientProps) {
    const router = useRouter();
    const { jobs, setJobs, hasLoaded, isLoading, refresh, reload } = useJobList();
    const { runJob, startingJobId } = useRunJob();
    const layout = useTableLayout(JOBS_TABLE_ID, initialLayout);
    const [filter, setFilter] = useState<JobFilter>("all");
    const [view, setView] = useState<ViewMode>(VIEWS.includes(initialView) ? initialView : "table");
    // A phone has no room for the table, so it always gets the cards and no switch. The list
    // waits until the screen is measured, so a phone never flashes the table first.
    const isMobile = useIsMobileState();
    const shownView: ViewMode | undefined = isMobile === undefined ? undefined : isMobile ? "cards" : view;

    const [form, setForm] = useState<{ open: boolean; job: JobListItem | null }>({ open: false, job: null });
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [cloneTarget, setCloneTarget] = useState<{ id: string; name: string } | null>(null);
    const [cloningId, setCloningId] = useState<string | null>(null);
    const [apiTrigger, setApiTrigger] = useState<{ id: string; name: string } | null>(null);
    // The id stays after closing, so the panel keeps its content while it slides out.
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);

    const changeView = useCallback((next: ViewMode) => {
        setView(next);
        saveViewLayout(JOBS_PAGE_ID, next)
            .then((result) => result.success)
            .catch(() => false)
            .then((saved) => {
                if (!saved) toast.error("Your view could not be saved.");
            });
    }, []);

    const run = useCallback(async (job: JobListItem) => {
        await runJob(job.id, job.name);
        void reload();
    }, [runJob, reload]);

    const toggle = useCallback(async (job: JobListItem) => {
        try {
            const result = await requestBulk("/api/jobs/bulk", { action: job.enabled ? "disable" : "enable", ids: [job.id] });
            // The bulk endpoint reports a job it could not change instead of failing the request.
            const failure = result.failed[0];
            if (failure) toast.error(failure.error || "The job could not be changed.");
            else toast.success(job.enabled ? `${job.name} paused` : `${job.name} runs on its schedule again`);
            void reload();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "The job could not be changed.");
        }
    }, [reload]);

    const clone = async (id: string, name: string) => {
        setCloningId(id);
        try {
            const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/clone`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok) {
                toast.success("Job cloned");
                void reload();
            } else {
                toast.error(data?.error || "The job could not be cloned.");
            }
        } catch {
            toast.error("The job could not be cloned.");
        } finally {
            setCloningId(null);
            setCloneTarget(null);
        }
    };

    const openForm = useCallback((job: JobListItem | null) => setForm({ open: true, job }), []);
    const openDetails = useCallback((job: JobListItem) => setDetails({ id: job.id, open: true }), []);

    /** What one job can do. The panel shows Run now and Edit as buttons of their own, so its menu leaves them out. */
    const handlers = useCallback((job: JobListItem, inPanel = false): JobActionHandlers => ({
        onRun: canExecute && !inPanel ? () => void run(job) : undefined,
        onOpenLastRun: canViewHistory && job.overview.lastRun ? () => router.push(`/dashboard/history?executionId=${job.overview.lastRun!.id}`) : undefined,
        backups: canViewStorage
            ? job.destinations.map((destination) => ({
                label: `Backups on ${destination.config.name}`,
                onSelect: () => router.push(`/dashboard/storage?destination=${destination.configId}&job=${encodeURIComponent(job.name)}`),
            }))
            : [],
        onApiTrigger: canExecute ? () => setApiTrigger({ id: job.id, name: job.name }) : undefined,
        onEdit: canManage && !inPanel ? () => openForm(job) : undefined,
        onClone: canManage ? () => setCloneTarget({ id: job.id, name: job.name }) : undefined,
        toggle: canManage ? { paused: !job.enabled, onSelect: () => void toggle(job) } : undefined,
        onDelete: canManage ? () => setDeletingId(job.id) : undefined,
        busy: startingJobId === job.id || cloningId === job.id,
    }), [canExecute, canViewHistory, canViewStorage, canManage, run, toggle, openForm, router, startingJobId, cloningId]);

    const renderActions = useCallback(
        (job: JobListItem) => <JobRowActions name={job.name} starting={startingJobId === job.id} {...handlers(job)} />,
        [handlers, startingJobId]
    );
    const columns = useMemo(() => jobColumns({ renderActions, onOpen: openDetails }), [renderActions, openDetails]);
    const bulkActions = useMemo(() => jobBulkActions(canManage), [canManage]);
    const visibleJobs = useMemo(() => jobs.filter((job) => matchesJobFilter(job, filter)), [jobs, filter]);

    // A deleted job has no row left to show, so its panel closes with it.
    const detailsJob = details ? jobs.find((job) => job.id === details.id) ?? null : null;
    const deleting = deletingId ? jobs.find((job) => job.id === deletingId) : undefined;
    const directorySourceOptions = useMemo(() => destinations.filter((option) => option.storageRole === STORAGE_ROLES.SOURCE), [destinations]);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 md:gap-3">
                <JobFilterTabs value={filter} onChange={setFilter} jobs={jobs} />
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {/* Hidden by CSS rather than by the measured screen, so it never pops in after loading. */}
                    <div className="hidden md:block">
                        <ViewSwitch value={view} onChange={changeView} views={VIEWS} />
                    </div>
                    {canManage && (
                        <Button tone="create" onClick={() => openForm(null)} aria-label="New job">
                            <Plus />
                            <span className="hidden sm:inline">New job</span>
                        </Button>
                    )}
                </div>
            </div>

            {!hasLoaded || !shownView ? (
                <LoadingList />
            ) : jobs.length === 0 ? (
                <NoJobs onCreate={canManage ? () => openForm(null) : undefined} />
            ) : (
                <DataTable
                    variant="card"
                    columns={columns}
                    data={visibleJobs}
                    searchKey="name"
                    searchPlaceholder="Search jobs"
                    onRefresh={refresh}
                    isLoading={isLoading}
                    // Selecting for bulk actions is a table thing. Cards keep to one job at a time.
                    enableRowSelection={canManage && shownView === "table"}
                    // Load-bearing here: the list is fetched again every few seconds while a job runs.
                    getRowId={(job) => job.id}
                    bulkActions={bulkActions}
                    onBulkActionComplete={reload}
                    columnLayout={layout}
                    initialPageSize={20}
                    onRowClick={openDetails}
                    view={shownView}
                    renderCard={(row) => <JobCard job={row.original} onOpen={openDetails} actions={renderActions(row.original)} />}
                    // A card shows the way of a backup from left to right, which needs more room than three abreast leave.
                    cardGridClassName="lg:grid-cols-2"
                    renderRowMenu={(job, bulk) => <JobContextMenu job={job} bulk={bulk} {...handlers(job)} />}
                />
            )}

            <JobDetailsSheet
                open={details !== null && details.open}
                job={detailsJob}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                canViewHistory={canViewHistory}
                onRun={detailsJob && canExecute ? () => void run(detailsJob) : undefined}
                starting={detailsJob !== null && startingJobId === detailsJob.id}
                onEdit={detailsJob && canManage ? () => openForm(detailsJob) : undefined}
                menu={detailsJob ? <JobRowActions name={detailsJob.name} showRun={false} {...handlers(detailsJob, true)} /> : null}
            />

            {/* New and Edit share one dialog. A job with parts beside a list gets the wide dialog, like a connection. */}
            <Dialog open={form.open} onOpenChange={(open) => setForm((current) => ({ ...current, open }))}>
                <DialogContent showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-4xl")}>
                    {form.open && (
                        <JobForm
                            sources={sources}
                            destinations={destinations}
                            directorySourceOptions={directorySourceOptions}
                            notifications={notificationChannels}
                            encryptionProfiles={encryptionProfiles}
                            initialData={form.job}
                            onSaved={() => {
                                setForm({ open: false, job: null });
                                void reload();
                            }}
                            // A connection added from the form comes back with the page, with its status and address.
                            onConnectionAdded={() => router.refresh()}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {deleting && (
                <JobDeleteDialog
                    job={deleting}
                    onClose={() => setDeletingId(null)}
                    onDeleted={(id) => setJobs((current) => current.filter((job) => job.id !== id))}
                />
            )}

            {apiTrigger && (
                <ApiTriggerDialog jobId={apiTrigger.id} jobName={apiTrigger.name} open onOpenChange={(open) => !open && setApiTrigger(null)} />
            )}

            <CloneDialog
                open={cloneTarget !== null}
                onOpenChange={(open) => !open && setCloneTarget(null)}
                defaultName={cloneTarget?.name ?? ""}
                existingNames={jobs.map((job) => job.name)}
                isLoading={cloningId !== null}
                onConfirm={async (name) => {
                    if (cloneTarget) await clone(cloneTarget.id, name);
                }}
            />
        </div>
    );
}
