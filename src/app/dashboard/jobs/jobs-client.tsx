"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, Plus } from "lucide-react";
import { toast } from "sonner";
import { saveViewLayout } from "@/app/actions/auth/table-preferences";
import { ApiTriggerDialog } from "@/components/dashboard/jobs/api-trigger-dialog";
import type { JobActionHandlers } from "@/components/dashboard/jobs/job-actions";
import { jobBulkActions } from "@/components/dashboard/jobs/job-bulk-actions";
import { JobCard } from "@/components/dashboard/jobs/job-card";
import { jobColumns } from "@/components/dashboard/jobs/job-columns";
import { JobDeleteDialog } from "@/components/dashboard/jobs/job-delete-dialog";
import { useTrash } from "@/components/trash/use-trash";
import { JobDetailsSheet } from "@/components/dashboard/jobs/job-details-sheet";
import { JobForm } from "@/components/dashboard/jobs/job-form";
import type { AdapterOption, EncryptionOption } from "@/components/dashboard/jobs/job-form-schema";
import { JobContextMenu, JobRowActions } from "@/components/dashboard/jobs/job-menus";
import { jobsAttention, type JobFilter } from "@/components/dashboard/jobs/job-status";
import { JobsStrip } from "@/components/dashboard/jobs/jobs-strip";
import { JobStatusFilter } from "@/components/dashboard/jobs/job-status-filter";
import { JobsTimelineViews } from "@/components/dashboard/jobs/timeline/jobs-timeline-views";
import { useJobTimeline } from "@/components/dashboard/jobs/timeline/use-job-timeline";
import { JOBS_PAGE_ID, JOBS_TABLE_ID } from "@/components/dashboard/jobs/job-tables";
import { useJobClone } from "@/components/dashboard/jobs/use-job-clone";
import { useJobList, useJobsBeside } from "@/components/dashboard/jobs/use-job-list";
import { useRunJob } from "@/components/dashboard/widgets/use-run-job";
import { Button } from "@/components/ui/button";
import { DIALOG_SURFACE } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ListEmpty } from "@/components/ui/list-empty";
import { JOIN_END, PageHead } from "@/components/ui/page-head";
import { PageTabs } from "@/components/ui/page-tabs";
import { Tabs } from "@/components/ui/tabs";
import { ViewSwitch } from "@/components/ui/view-switch";
import { useIsMobileState } from "@/hooks/use-mobile";
import { useTableLayout } from "@/hooks/use-table-layout";
import { requestBulk } from "@/lib/bulk-request";
import type { TablePreferences, ViewMode } from "@/lib/core/table-preferences";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { cn } from "@/lib/utils";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { runHref } from "@/components/dashboard/history/run-links";
import { useOpenFromLink } from "@/hooks/use-open-from-link";
import { useNewFromLink } from "@/hooks/use-new-from-link";
import { useNewInTenant, useOpenRecord } from "@/components/tenant/tenant-actions";
import { useTenantColumns } from "@/components/tenant/tenant-column";
import { withTenantColumn, withTenantCounts } from "@/components/tenant/tenant-rows";

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

const tenantOfJob = (job: JobListItem) => job.tenantId;
const jobHref = (job: JobListItem) => `/dashboard/jobs?job=${encodeURIComponent(job.id)}`;

/** The views the Jobs page offers: the table, cards, the runs over the hours, and the runs to come by time. */
const VIEWS: ViewMode[] = ["table", "cards", "timeline", "upcoming"];

function LoadingList() {
    return (
        <div className={cn("space-y-3 rounded-xl border bg-card p-4 shadow-sm", JOIN_END)} aria-busy="true">
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

export function JobsClient({
    canManage, canExecute, canViewHistory, canViewStorage, sources, destinations, notificationChannels, encryptionProfiles, initialLayout, initialView,
}: JobsClientProps) {
    const router = useRouter();
    const { runJob, startingJobId } = useRunJob("jobs");
    const layout = useTableLayout(JOBS_TABLE_ID, initialLayout);
    const [filter, setFilter] = useState<JobFilter>("all");
    const [view, setView] = useState<ViewMode>(VIEWS.includes(initialView) ? initialView : "table");
    // A phone has no room for the table, so it always gets the cards and no switch. The list
    // waits until the screen is measured, so a phone never flashes the table first.
    const isMobile = useIsMobileState();
    const shownView: ViewMode | undefined = isMobile === undefined ? undefined : isMobile ? "cards" : view;
    // Timeline and Upcoming draw the jobs the search and filters leave above rows they hide.
    const timelineView = shownView === "timeline" || shownView === "upcoming";
    const timeline = useJobTimeline(timelineView);
    // The server pages, searches and filters the jobs, and counts them for the quick filters and the numbers.
    const list = useJobList({ filter, timeline: timelineView, pageSize: initialLayout?.pageSize, enabled: shownView !== undefined });
    const { rows: jobs, page, loaded: hasLoaded, isLoading, refresh } = list;
    const reload = refresh;

    const [form, setForm] = useState<{ open: boolean; job: JobListItem | null }>({ open: false, job: null });
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [apiTrigger, setApiTrigger] = useState<{ id: string; name: string } | null>(null);
    // The id stays after closing, so the panel keeps its content while it slides out.
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);
    // A job a link names, or whose panel or dialog stays open while the list shows another page, is
    // read on its own.
    const linked = useSearchParams().get("job");
    const beside = useJobsBeside(jobs, [linked, details?.id, deletingId]);
    const jobOf = useCallback((id: string) => jobs.find((job) => job.id === id) ?? beside.jobs.find((job) => job.id === id) ?? null, [jobs, beside.jobs]);

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

    const shownNames = useMemo(() => jobs.map((job) => job.name), [jobs]);
    const { start: startClone, cloningId, dialog: cloneDialog } = useJobClone(shownNames, () => void reload());

    const openForm = useCallback((job: JobListItem | null) => setForm({ open: true, job }), []);
    // In All tenants the list holds the jobs of every tenant, and one opens in its tenant. Without
    // rows, since the server pages the list, the Tenant filter offers every tenant.
    const tenant = useTenantColumns(tenantOfJob);
    const { allTenants: inAllTenants, nameOf: tenantNameOf } = tenant;
    const openRecord = useOpenRecord();
    const showDetails = useCallback((job: JobListItem) => setDetails({ id: job.id, open: true }), []);
    const openDetails = useCallback((job: JobListItem) => openRecord(job.tenantId, jobHref(job), () => showDetails(job)), [openRecord, showDetails]);
    // A link like Open job of the Backups page or the search in the header names a job with `?job=`,
    // which may be on another page than the first.
    const linkRows = useMemo(() => (hasLoaded && beside.ready ? [...jobs, ...beside.jobs] : null), [hasLoaded, beside.ready, jobs, beside.jobs]);
    useOpenFromLink(linkRows, showDetails, "job");
    // A job belongs to one tenant, so in All tenants New asks for it and opens the form there.
    const openNewForm = useCallback(() => openForm(null), [openForm]);
    const newJob = useNewInTenant({
        canCreate: canManage,
        title: "New job",
        description: "A job belongs to one tenant, pick the one it runs in.",
        href: "/dashboard/jobs?new=1",
        onCreate: openNewForm,
    });
    useNewFromLink(hasLoaded && canManage, openNewForm);

    /** What one job can do. The panel shows Run now and Edit as buttons of their own, so its menu leaves them out. */
    const handlers = useCallback((job: JobListItem, inPanel = false): JobActionHandlers => ({
        onRun: canExecute && !inPanel ? () => void run(job) : undefined,
        onOpenLastRun: canViewHistory && job.overview.lastRun ? () => router.push(runHref(job.overview.lastRun!.id, "jobs")) : undefined,
        backups: canViewStorage
            ? [{ label: "Open backups", onSelect: () => router.push(`/dashboard/backups?job=${encodeURIComponent(job.id)}`) }]
            : [],
        onApiTrigger: canExecute ? () => setApiTrigger({ id: job.id, name: job.name }) : undefined,
        openInTenant: inAllTenants && tenantNameOf(job.tenantId)
            ? { label: `Open in ${tenantNameOf(job.tenantId)}`, onSelect: () => openDetails(job) }
            : undefined,
        onEdit: canManage && !inPanel ? () => openForm(job) : undefined,
        onClone: canManage ? () => startClone(job) : undefined,
        toggle: canManage ? { paused: !job.enabled, onSelect: () => void toggle(job) } : undefined,
        onDelete: canManage ? () => setDeletingId(job.id) : undefined,
        busy: startingJobId === job.id || cloningId === job.id,
    }), [canExecute, canViewHistory, canViewStorage, canManage, run, toggle, openForm, startClone, router, startingJobId, cloningId, inAllTenants, tenantNameOf, openDetails]);

    const renderActions = useCallback(
        (job: JobListItem) => <JobRowActions name={job.name} starting={startingJobId === job.id} {...handlers(job)} />,
        [handlers, startingJobId]
    );
    const columns = useMemo(() => withTenantColumn(jobColumns({ renderActions, onOpen: openDetails }), tenant.column), [renderActions, openDetails, tenant.column]);
    // The numbers of the Tenant filter come from the server, which counts under the search and the quick filter.
    const tenantCounts = page?.tenants;
    const filterableColumns = useMemo(() => (tenant.filter ? [withTenantCounts(tenant.filter, tenantCounts)] : []), [tenant.filter, tenantCounts]);
    const trash = useTrash("job", reload);
    const bulkActions = useMemo(() => jobBulkActions(canManage, trash), [canManage, trash]);

    // A deleted job has no row left to show, so its panel closes with it.
    const detailsJob = details ? jobOf(details.id) : null;
    const deleting = deletingId ? jobOf(deletingId) ?? undefined : undefined;
    const directorySourceOptions = useMemo(() => destinations.filter((option) => option.storageRole === STORAGE_ROLES.SOURCE), [destinations]);

    return (
        <div className="space-y-4 md:space-y-0">
            {/* One tab for the one list, so the row reads like the Connections page, whose tabs switch
                between kinds of connections. The filters of the list sit beside its search. */}
            <PageHead>
                <Tabs value="jobs" className="min-w-0 flex-1">
                    <PageTabs tabs={[{ value: "jobs", label: "Jobs", icon: CalendarClock, attention: page ? jobsAttention(page.stats) : undefined }]} value="jobs" onValueChange={() => undefined} label="Job list" />
                </Tabs>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {/* Hidden by CSS rather than by the measured screen, so it never pops in after loading. */}
                    <div className="hidden md:block">
                        <ViewSwitch value={view} onChange={changeView} views={VIEWS} />
                    </div>
                    {newJob.available && (
                        <Button tone="create" onClick={newJob.start} aria-label="New job">
                            <Plus />
                            <span className="hidden sm:inline">New job</span>
                        </Button>
                    )}
                </div>
            </PageHead>

            {!hasLoaded || !page || !shownView ? (
                <LoadingList />
            ) : page.stats.total === 0 ? (
                <ListEmpty
                    icon={CalendarClock}
                    title="No backup jobs yet"
                    description="A job backs up a database or folders on a schedule and keeps the backups where you say."
                    action={newJob.available ? { label: "New job", onClick: newJob.start } : undefined}
                />
            ) : (
                <>
                    <JobsStrip stats={page.stats} />
                    <DataTable
                        joined
                        columns={columns}
                        data={jobs}
                        searchKey="name"
                        searchPlaceholder="Search jobs"
                        filterableColumns={filterableColumns}
                        manualPagination
                        manualFiltering
                        pagination={list.pagination}
                        onPaginationChange={list.setPagination}
                        columnFilters={list.columnFilters}
                        onColumnFiltersChange={list.onColumnFiltersChange}
                        pageCount={list.pageCount}
                        rowCount={list.total}
                        toolbarExtra={<JobStatusFilter value={filter} onChange={setFilter} counts={page.counts} />}
                        onRefresh={() => {
                            if (timelineView) timeline.reload();
                            return refresh();
                        }}
                        isLoading={isLoading}
                        // Selecting for bulk actions is a table thing. Cards keep to one job at a time.
                        enableRowSelection={canManage && shownView === "table"}
                        // Load-bearing here: the list is fetched again every few seconds while a job runs.
                        getRowId={(job) => job.id}
                        bulkActions={bulkActions}
                        onBulkActionComplete={reload}
                        columnLayout={layout}
                        onRowClick={openDetails}
                        view={shownView === "cards" ? "cards" : "table"}
                        aboveRows={timelineView
                            ? <JobsTimelineViews view={shownView} jobs={jobs} total={list.total} timeline={timeline} canViewHistory={canViewHistory} onOpenJob={openDetails} />
                            : undefined}
                        hideRows={timelineView}
                        renderCard={(row) => <JobCard job={row.original} onOpen={openDetails} actions={renderActions(row.original)} tenantName={tenant.allTenants ? tenant.nameOf(row.original.tenantId) : null} />}
                        // A card shows the way of a backup from left to right, which needs more room than three abreast leave.
                        cardGridClassName="lg:grid-cols-2"
                        renderRowMenu={(job, bulk) => <JobContextMenu job={job} bulk={bulk} {...handlers(job)} />}
                    />
                </>
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
                    onDeleted={() => void reload()}
                    onRestored={reload}
                />
            )}

            {newJob.dialog}

            {apiTrigger && (
                <ApiTriggerDialog jobId={apiTrigger.id} jobName={apiTrigger.name} open onOpenChange={(open) => !open && setApiTrigger(null)} />
            )}

            {cloneDialog}
        </div>
    );
}
