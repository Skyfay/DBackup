"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Database, HardDrive, Loader2, FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useState, useMemo } from "react";
import type { LatestJobEntry } from "@/services/dashboard-service";

interface LatestJobsProps {
  data: LatestJobEntry[];
}

export function LatestJobs({ data }: LatestJobsProps) {
  const [typeFilter, setTypeFilter] = useState("all");

  const filteredData = useMemo(() => {
    if (typeFilter === "all") return data;
    return data.filter((job) => job.type.toLowerCase() === typeFilter);
  }, [data, typeFilter]);

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Latest Jobs</CardTitle>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-28 h-8 text-xs">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="backup">Backup</SelectItem>
            <SelectItem value="restore">Restore</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {filteredData.length === 0 ? (
            <div className="flex h-50 items-center justify-center text-sm text-muted-foreground">
              {typeFilter === "all"
                ? "No executions found."
                : `No ${typeFilter} executions found.`}
            </div>
          ) : (
            filteredData.map((job) => {
              const isRunning = job.status === "Running";
              const isSuccess = job.status === "Success";

              return (
                <Link
                  href={`/dashboard/history?executionId=${job.id}`}
                  key={job.id}
                  className="block group"
                >
                  <div className="flex items-center justify-between hover:bg-muted/50 px-2 py-2.5 -mx-2 rounded-md transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <TypeBadge type={job.type} />
                      <SourceIcon sourceType={job.sourceType} isRunning={isRunning} isSuccess={isSuccess} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-none truncate">
                          {job.jobName}
                        </p>
                        {job.databaseName && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {job.databaseName}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      <StatusBadge status={job.status} />
                      <span className="text-xs text-muted-foreground w-24 text-right whitespace-nowrap">
                        {isRunning ? (
                          <span className="text-blue-500 animate-pulse">Live</span>
                        ) : (
                          formatDistanceToNow(new Date(job.startedAt), { addSuffix: true, includeSeconds: true })
                            .replace("less than ", "")
                        )}
                      </span>
                      <div className="w-3.5">
                        {job.duration > 0 && !isRunning && (
                          <FileText className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge
      variant="outline"
      className="text-[10px] px-1.5 py-0 shrink-0 font-medium"
    >
      {type}
    </Badge>
  );
}

function SourceIcon({
  sourceType,
  isRunning,
  isSuccess,
}: {
  sourceType: string | null;
  isRunning: boolean;
  isSuccess: boolean;
}) {
  const className = `h-4 w-4 shrink-0 ${
    isRunning
      ? "text-blue-500"
      : isSuccess
        ? "text-green-500"
        : "text-red-500"
  }`;

  if (isRunning) return <Loader2 className={`${className} animate-spin`} />;
  if (sourceType === "database") return <Database className={className} />;
  return <HardDrive className={className} />;
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; label: string }> = {
    Success: { bg: "bg-[hsl(145,78%,45%)]", label: "Done" },
    Failed: { bg: "bg-[hsl(357,78%,54%)]", label: "Failed" },
    Running: { bg: "bg-[hsl(225,79%,54%)]", label: "Running" },
    Pending: { bg: "bg-[hsl(45,93%,58%)]", label: "Pending" },
  };

  const { bg, label } = config[status] ?? { bg: "bg-muted", label: status };

  return (
    <Badge className={`${bg} text-white border-transparent text-[10px] px-1.5 py-0`}>
      {label}
    </Badge>
  );
}
