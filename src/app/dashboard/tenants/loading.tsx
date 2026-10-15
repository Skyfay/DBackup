import { ListPageSkeleton } from "@/components/layout/page-skeletons";

/** The Tenants page while it loads: its tab, the numbers and the tenants. */
export default function TenantsLoading() {
    return <ListPageSkeleton label="Loading the tenants" tabsClassName="md:w-40" rowClassName="h-12" />;
}
