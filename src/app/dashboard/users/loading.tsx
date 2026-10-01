import { ListPageSkeleton } from "@/components/layout/page-skeletons";

/** Users & Groups while it loads: its tabs, the numbers and the list. */
export default function UsersLoading() {
    return <ListPageSkeleton label="Loading users and groups" tabsClassName="md:w-72" rows={5} rowClassName="h-12" />;
}
