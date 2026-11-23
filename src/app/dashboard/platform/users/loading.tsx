import { ListPageSkeleton } from "@/components/layout/page-skeletons";

/** Users & Groups of the platform while it loads: its tabs, the numbers and the list. */
export default function PlatformUsersLoading() {
    return <ListPageSkeleton label="Loading every account" tabsClassName="md:w-96" rows={5} rowClassName="h-12" />;
}
