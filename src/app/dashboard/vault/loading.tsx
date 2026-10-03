import { ListPageSkeleton } from "@/components/layout/page-skeletons";

/** The Vault while it loads: its tabs, the numbers and the list. */
export default function VaultLoading() {
    return <ListPageSkeleton label="Loading the Vault" tabsClassName="md:w-56" rows={4} />;
}
