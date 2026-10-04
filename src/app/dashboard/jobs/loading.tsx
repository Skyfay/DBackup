import { ListPageSkeleton } from "@/components/layout/page-skeletons";

/** The Jobs page while it loads: its tab, the numbers and the jobs. */
export default function JobsLoading() {
    return <ListPageSkeleton label="Loading the jobs" tabsClassName="md:w-40" rowClassName="h-14" />;
}
