import Link from "next/link";
import { Building2, UserRound } from "lucide-react";
import { PageProblem } from "@/components/layout/page-problem";
import { Button } from "@/components/ui/button";

/**
 * The Overview of an account that works in no tenant yet, like someone whose group an upgrade or
 * an admin took away. Every page it may not open leads here, so it says calmly what is missing
 * and keeps the own profile one click away.
 */
export function NoTenantNote() {
    return (
        <PageProblem
            icon={Building2}
            title="You work in no tenant yet"
            actions={
                <Button asChild>
                    <Link href="/dashboard/profile">
                        <UserRound />
                        Open your profile
                    </Link>
                </Button>
            }
        >
            Connections, jobs and backups belong to a tenant. An admin can add you to one, or send you an invitation link that adds you once you open it.
        </PageProblem>
    );
}
