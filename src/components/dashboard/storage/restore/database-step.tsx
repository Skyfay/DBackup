"use client";

import { useState } from "react";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewSwitch } from "@/components/ui/view-switch";
import type { ViewMode } from "@/lib/core/table-preferences";
import { DatabaseLines } from "./database-lines";
import { DatabaseRows } from "./database-rows";
import { DatabaseTarget } from "./database-target";
import type { DbFilter } from "./restore-model";
import { Section } from "./restore-parts";
import type { RestoreDatabases } from "./use-restore-databases";

const VIEWS: ViewMode[] = ["table", "lines"];

/**
 * An older backup holds one dump without the names of its databases. It goes into the original
 * database, or into one named here.
 */
function SingleDump({ databases }: { databases: RestoreDatabases }) {
    const [asNew, setAsNew] = useState(databases.classicName !== "");
    const path = databases.isFirebird;
    return (
        <Section title="Database" note="This backup holds one dump without the names of its databases.">
            <ChoiceCards
                value={asNew ? "new" : "original"}
                onValueChange={(value) => {
                    setAsNew(value === "new");
                    if (value === "original") databases.setClassicName("");
                }}
                options={[
                    { value: "original", title: "Into the original database", description: "The dump goes back where it came from. What is there is overwritten." },
                    { value: "new", title: path ? "Into another path" : "Under a new name", description: path ? "A Firebird path. A file there is overwritten, DBackup cannot check it." : "A database of that name is created beside the others." },
                ]}
            />
            {asNew && (
                <Input
                    value={databases.classicName}
                    onChange={(event) => databases.setClassicName(event.target.value)}
                    placeholder={path ? "/path/to/database.fdb" : "shop_restored"}
                    className="mt-3 max-w-md font-mono"
                    aria-label={path ? "Path of the database" : "Name of the new database"}
                    autoFocus
                />
            )}
        </Section>
    );
}

interface DatabaseStepProps {
    databases: RestoreDatabases;
    /** Whether the backup names its databases. Older ones hold a single dump. */
    named: boolean;
    loading: boolean;
    canDownload: boolean;
    view: ViewMode;
    onView: (view: ViewMode) => void;
    onDownload: (name: string) => void;
}

/** The server the databases go to, then the databases as rows or as lines. */
export function DatabaseStep({ databases, named, loading, canDownload, view, onView, onDownload }: DatabaseStepProps) {
    const [filter, setFilter] = useState<DbFilter>("all");
    const serverName = databases.options.find((option) => option.id === databases.target)?.name ?? null;
    const viewSwitch = <ViewSwitch value={view} onChange={onView} views={VIEWS} />;

    let list: React.ReactNode;
    if (loading) {
        list = <Skeleton className="h-64 w-full rounded-xl" />;
    } else if (!named) {
        list = <SingleDump databases={databases} />;
    } else if (view === "lines") {
        list = (
            <Section title="Databases" note="What comes back on the left, where it goes on the right. A click on one opens its rows." action={viewSwitch}>
                <DatabaseLines
                    rows={databases.rows}
                    serverName={serverName}
                    onOpen={(next) => {
                        setFilter(next);
                        onView("table");
                    }}
                />
            </Section>
        );
    } else {
        list = (
            <DatabaseRows
                rows={databases.rows}
                serverName={serverName}
                canDownload={canDownload}
                filter={filter}
                onFilter={setFilter}
                toolbarEnd={viewSwitch}
                onPick={databases.setPicked}
                onRename={databases.rename}
                onCopies={databases.asCopies}
                onOwnNames={databases.ownNames}
                onDownload={onDownload}
            />
        );
    }

    return (
        <div className="space-y-4 md:space-y-6">
            <DatabaseTarget databases={databases} />
            {list}
        </div>
    );
}
