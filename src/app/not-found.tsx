import Link from "next/link";
import { MapPinOff } from "lucide-react";
import { PageProblem, PageProblemScreen } from "@/components/layout/page-problem";
import { Button } from "@/components/ui/button";

/** Any address no page answers, like an old bookmark or a typo. */
export default function NotFound() {
    return (
        <PageProblemScreen>
            <PageProblem
                icon={MapPinOff}
                title="This page does not exist"
                className="w-full max-w-lg"
                actions={
                    <Button asChild>
                        <Link href="/dashboard">Go to the overview</Link>
                    </Button>
                }
            >
                The address may be old or mistyped.
            </PageProblem>
        </PageProblemScreen>
    );
}
