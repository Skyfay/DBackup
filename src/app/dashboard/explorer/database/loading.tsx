import { RecordPageSkeleton } from "@/components/layout/page-skeletons";

/** The page of a database while it loads. */
export default function DatabaseLoading() {
    return <RecordPageSkeleton label="Loading the database" />;
}
