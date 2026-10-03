import { ListPageSkeleton } from "@/components/layout/page-skeletons";

/** Connections while they load: the tabs of the four lists, the numbers and the list. */
export default function ConnectionsLoading() {
    return <ListPageSkeleton label="Loading the connections" tabsClassName="md:w-[36rem]" />;
}
