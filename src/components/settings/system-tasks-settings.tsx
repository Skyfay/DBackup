"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Play } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface SystemTask {
    id: string;
    schedule: string;
    runOnStartup: boolean;
    enabled: boolean;
    label: string;
    description: string;
}

export function SystemTasksSettings() {
    const [tasks, setTasks] = useState<SystemTask[]>([]);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState<Record<string, string>>({});

    useEffect(() => {
        fetchTasks();
    }, []);

    const fetchTasks = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/settings/system-tasks");
            if (res.ok) {
                setTasks(await res.json());
            }
        } catch {
            toast.error("Failed to load task schedules");
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (taskId: string) => {
        const schedule = editing[taskId];
        if (!schedule) return;

        try {
            const res = await fetch("/api/settings/system-tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskId, schedule }),
            });
            if (res.ok) {
                toast.success("Schedule updated");
                fetchTasks(); // Refresh to clean state
                const newEdit = { ...editing };
                delete newEdit[taskId];
                setEditing(newEdit);
            } else {
                toast.error("Failed to update schedule");
            }
        } catch {
            toast.error("Error saving schedule");
        }
    };

    const handleToggleEnabled = async (taskId: string, current: boolean) => {
        try {
            // Optimistic update
            const newTasks = tasks.map(t => t.id === taskId ? { ...t, enabled: !current } : t);
            setTasks(newTasks);

            const res = await fetch("/api/settings/system-tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskId, enabled: !current }),
            });

            if (!res.ok) {
                // Revert
                fetchTasks();
                toast.error("Failed to update setting");
            } else {
                toast.success("Task status updated");
            }
        } catch {
             fetchTasks();
            toast.error("Error saving setting");
        }
    };

    const handleToggleStartup = async (taskId: string, current: boolean) => {
        try {
            // Optimistic update
            const newTasks = tasks.map(t => t.id === taskId ? { ...t, runOnStartup: !current } : t);
            setTasks(newTasks);

            const res = await fetch("/api/settings/system-tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskId, runOnStartup: !current }),
            });

            if (!res.ok) {
                // Revert
                fetchTasks();
                toast.error("Failed to update setting");
            } else {
                toast.success("Startup setting updated");
            }
        } catch {
             fetchTasks();
            toast.error("Error saving setting");
        }
    };

    const handleRun = async (taskId: string) => {
        try {
            const res = await fetch("/api/settings/system-tasks", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskId }),
            });
            if (res.ok) {
                toast.success("Task started in background");
            } else {
                toast.error("Failed to start task");
            }
        } catch {
            toast.error("Error starting task");
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>System Tasks</CardTitle>
                <CardDescription>
                    Configure frequency of background maintenance tasks.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-6">
                    {loading && <div>Loading...</div>}
                    {!loading && tasks.map(task => (
                        <div key={task.id} className="flex items-center justify-between p-4 border rounded-lg">
                            <div className="space-y-1 flex-1">
                                <div className="flex items-center space-x-2">
                                    <h4 className="font-semibold">{task.label}</h4>
                                    {!task.enabled && <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">Disabled</span>}
                                </div>
                                <p className="text-sm text-muted-foreground">{task.description}</p>
                            </div>
                            <div className="flex items-center space-x-4">
                                <div className="flex items-center space-x-2 border-r pr-4 mr-2">
                                     <Switch
                                        id={`enabled-${task.id}`}
                                        checked={task.enabled}
                                        onCheckedChange={() => handleToggleEnabled(task.id, task.enabled)}
                                     />
                                     <Label htmlFor={`enabled-${task.id}`} className="text-xs">Enabled</Label>
                                </div>

                                <div className={`flex items-center space-x-2 ${!task.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                    <span className="text-sm font-mono text-muted-foreground">Cron:</span>
                                    <Input
                                        className="w-37.5 font-mono"
                                        value={editing[task.id] !== undefined ? editing[task.id] : task.schedule}
                                        onChange={(e) => setEditing({...editing, [task.id]: e.target.value})}
                                    />
                                </div>
                                {editing[task.id] && (
                                     <Button size="sm" onClick={() => handleSave(task.id)}>Save</Button>
                                )}

                                <div className="flex items-center border-l pl-4 mx-2">
                                    <Button size="sm" variant="outline" onClick={() => handleRun(task.id)}>
                                        <Play className="h-4 w-4 mr-1" /> Run Now
                                    </Button>
                                </div>

                                <div className="flex items-center space-x-2 border-l pl-4 mx-2">
                                     <Switch
                                        id={`startup-${task.id}`}
                                        checked={task.runOnStartup}
                                        onCheckedChange={() => handleToggleStartup(task.id, task.runOnStartup)}
                                     />
                                     <Label htmlFor={`startup-${task.id}`} className="text-xs">Run on start</Label>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
