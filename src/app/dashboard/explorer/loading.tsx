import { ListPageSkeleton } from "@/components/layout/page-skeletons";

/** The Database Explorer while it loads: its tabs, the numbers and the list. */
export default function ExplorerLoading() {
    return <ListPageSkeleton label="Loading the databases" tabsClassName="md:w-64" />;
}
