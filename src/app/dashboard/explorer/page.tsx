import { Suspense } from "react";
import { DatabaseExplorer } from "@/components/dashboard/explorer/database-explorer";
import prisma from "@/lib/prisma";
import { getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

interface SourceOption {
    id: string;
    name: string;
    adapterId: string;
}

export default async function ExplorerPage() {
    await getUserPermissions(); // Throws if not authenticated

    // Fetch all database-type adapter configs
    const sources = await prisma.adapterConfig.findMany({
        where: { type: "database" },
        select: { id: true, name: true, adapterId: true },
        orderBy: { name: "asc" },
    });

    const sourceOptions: SourceOption[] = sources.map((s) => ({
        id: s.id,
        name: s.name,
        adapterId: s.adapterId,
    }));

    return (
        <Suspense>
            <DatabaseExplorer sources={sourceOptions} />
        </Suspense>
    );
}
