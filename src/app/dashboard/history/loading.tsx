import { ListPageSkeleton } from "@/components/layout/page-skeletons";

/** History while it loads: its tabs, the numbers of 30 days and the runs. */
export default function HistoryLoading() {
    return <ListPageSkeleton label="Loading the history" tabsClassName="md:w-64" />;
}
