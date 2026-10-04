import { RecordPageSkeleton } from "@/components/layout/page-skeletons";

/** The page of a server while it loads. */
export default function ServerLoading() {
    return <RecordPageSkeleton label="Loading the server" />;
}
