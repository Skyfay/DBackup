import { ListPageSkeleton } from "@/components/layout/page-skeletons";

/** The Backups page while it loads: its tabs, the numbers and the list. */
export default function BackupsLoading() {
    return <ListPageSkeleton label="Loading the backups" tabsClassName="md:w-64" />;
}
