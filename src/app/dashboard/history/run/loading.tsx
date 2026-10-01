import { RecordPageSkeleton } from "@/components/layout/page-skeletons";

/** The page of a run while it loads. */
export default function RunLoading() {
    return <RecordPageSkeleton label="Loading the run" />;
}
