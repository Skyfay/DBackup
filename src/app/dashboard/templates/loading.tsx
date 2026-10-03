import { ListPageSkeleton } from "@/components/layout/page-skeletons";

/** The Templates page while it loads: its tabs, the numbers and the list. */
export default function TemplatesLoading() {
    return <ListPageSkeleton label="Loading the templates" tabsClassName="md:w-[36rem]" rows={4} rowClassName="h-12" />;
}
