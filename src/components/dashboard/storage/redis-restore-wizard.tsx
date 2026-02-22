"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    Download,
    Server,
    RefreshCw,
    CheckCircle2,
    Circle,
    AlertTriangle,
    Copy,
    ChevronRight,
    ArrowLeft,
} from "lucide-react";
import { FileInfo } from "@/app/dashboard/storage/columns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface RedisRestoreWizardProps {
    file: FileInfo;
    destinationId: string;
    onCancel: () => void;
}

type WizardStep = "intro" | "download" | "stop" | "replace" | "start" | "verify";

const STEPS: { id: WizardStep; title: string; description: string }[] = [
    { id: "intro", title: "Overview", description: "Understand the restore process" },
    { id: "download", title: "Download Backup", description: "Get the RDB file" },
    { id: "stop", title: "Stop Redis", description: "Safely shut down the server" },
    { id: "replace", title: "Replace RDB", description: "Copy the backup file" },
    { id: "start", title: "Start Redis", description: "Restart the server" },
    { id: "verify", title: "Verify", description: "Confirm data restored" },
];

function CommandBlock({ command, label }: { command: string; label?: string }) {
    const copyToClipboard = () => {
        navigator.clipboard.writeText(command);
        toast.success("Copied to clipboard");
    };

    return (
        <div className="space-y-1.5">
            {label && <p className="text-sm font-medium">{label}</p>}
            <div className="relative group">
                <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap break-all font-mono">
                    {command}
                </pre>
                <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={copyToClipboard}
                >
                    <Copy className="h-3 w-3" />
                </Button>
            </div>
        </div>
    );
}

export function RedisRestoreWizard({ file, destinationId, onCancel }: RedisRestoreWizardProps) {
    const [currentStep, setCurrentStep] = useState<WizardStep>("intro");
    const [completedSteps, setCompletedSteps] = useState<Set<WizardStep>>(new Set());
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
    const [isGeneratingUrl, setIsGeneratingUrl] = useState(false);

    // Reset on mount
    useEffect(() => {
        setCurrentStep("intro");
        setCompletedSteps(new Set());
        setDownloadUrl(null);
    }, [file]);

    const markStepComplete = (step: WizardStep) => {
        setCompletedSteps(prev => new Set([...prev, step]));
    };

    const goToNextStep = () => {
        const currentIndex = STEPS.findIndex(s => s.id === currentStep);
        if (currentIndex < STEPS.length - 1) {
            markStepComplete(currentStep);
            setCurrentStep(STEPS[currentIndex + 1].id);
        }
    };

    const goToPrevStep = () => {
        const currentIndex = STEPS.findIndex(s => s.id === currentStep);
        if (currentIndex > 0) {
            setCurrentStep(STEPS[currentIndex - 1].id);
        }
    };

    const generateDownloadUrl = async () => {
        if (!file) return;
        setIsGeneratingUrl(true);
        try {
            const res = await fetch(`/api/storage/${destinationId}/download-url`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file: file.path })
            });
            if (res.ok) {
                const data = await res.json();
                setDownloadUrl(data.url);
            } else {
                toast.error("Failed to generate download URL");
            }
        } catch {
            toast.error("Failed to generate download URL");
        } finally {
            setIsGeneratingUrl(false);
        }
    };

    const currentStepIndex = STEPS.findIndex(s => s.id === currentStep);

    return (
        <div className="space-y-6">
            {/* Redis Wizard Header Card */}
            <Card className="border-red-500/20 bg-red-500/5">
                <CardContent className="flex items-center gap-3 py-4">
                    <Server className="h-5 w-5 text-red-500 shrink-0" />
                    <div>
                        <p className="font-semibold leading-none">Redis Restore Wizard</p>
                        <p className="text-sm text-muted-foreground mt-1">
                            Redis requires manual steps to restore. Follow this wizard carefully.
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* Step Progress */}
            <Card>
                <CardContent className="py-4">
                    <div className="flex items-center justify-center gap-1">
                        {STEPS.map((step, index) => (
                            <div key={step.id} className="flex items-center">
                                <button
                                    onClick={() => {
                                        if (completedSteps.has(step.id) || index <= currentStepIndex) {
                                            setCurrentStep(step.id);
                                        }
                                    }}
                                    className={cn(
                                        "flex flex-col items-center gap-1.5 transition-colors",
                                        currentStep === step.id ? "text-primary" : "text-muted-foreground",
                                        (completedSteps.has(step.id) || index <= currentStepIndex) && "cursor-pointer hover:text-primary"
                                    )}
                                >
                                    <div className={cn(
                                        "w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors",
                                        currentStep === step.id && "border-primary bg-primary text-primary-foreground",
                                        completedSteps.has(step.id) && currentStep !== step.id && "border-green-500 bg-green-500 text-white",
                                        !completedSteps.has(step.id) && currentStep !== step.id && "border-muted-foreground/30"
                                    )}>
                                        {completedSteps.has(step.id) && currentStep !== step.id ? (
                                            <CheckCircle2 className="h-4 w-4" />
                                        ) : (
                                            <span className="text-xs font-medium">{index + 1}</span>
                                        )}
                                    </div>
                                    <span className="text-[11px] font-medium hidden sm:block">{step.title}</span>
                                </button>
                                {index < STEPS.length - 1 && (
                                    <ChevronRight className="h-4 w-4 mx-1.5 text-muted-foreground/50" />
                                )}
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Step Content */}
            <Card>
                <CardContent className="py-6">
                    {currentStep === "intro" && (
                        <div className="space-y-4">
                            <Alert>
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle>Why is Redis restore different?</AlertTitle>
                                <AlertDescription className="mt-2 text-sm">
                                    Unlike SQL databases, Redis cannot load RDB files remotely via network commands.
                                    The RDB file must be physically placed on the Redis server and the server restarted.
                                </AlertDescription>
                            </Alert>

                            <div className="space-y-3">
                                <h4 className="font-medium">This wizard will guide you through:</h4>
                                <ul className="space-y-2 text-sm text-muted-foreground">
                                    <li className="flex items-center gap-2">
                                        <Circle className="h-2 w-2 fill-current" />
                                        Downloading the backup file
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <Circle className="h-2 w-2 fill-current" />
                                        Safely stopping your Redis server
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <Circle className="h-2 w-2 fill-current" />
                                        Replacing the RDB file on your server
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <Circle className="h-2 w-2 fill-current" />
                                        Restarting Redis to load the data
                                    </li>
                                </ul>
                            </div>

                            <Alert variant="destructive">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle>Data Loss Warning</AlertTitle>
                                <AlertDescription className="text-sm">
                                    This will completely replace all data in your Redis server.
                                    The current data will be permanently lost.
                                </AlertDescription>
                            </Alert>
                        </div>
                    )}

                    {currentStep === "download" && (
                        <div className="space-y-4">
                            <h4 className="font-medium">Step 1: Download the Backup File</h4>
                            <p className="text-sm text-muted-foreground">
                                First, download the RDB backup file to your local machine or directly to your server.
                            </p>

                            <div className="flex flex-col gap-3">
                                {!downloadUrl ? (
                                    <Button onClick={generateDownloadUrl} disabled={isGeneratingUrl}>
                                        {isGeneratingUrl ? (
                                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                        ) : (
                                            <Download className="h-4 w-4 mr-2" />
                                        )}
                                        Generate Download Link
                                    </Button>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                                            <span className="text-sm font-medium">Download link ready!</span>
                                            <Badge variant="outline" className="text-xs">Expires in 5 min</Badge>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button asChild>
                                                <a href={downloadUrl} download>
                                                    <Download className="h-4 w-4 mr-2" />
                                                    Download File
                                                </a>
                                            </Button>
                                            <Button variant="outline" size="icon" onClick={() => {
                                                navigator.clipboard.writeText(downloadUrl);
                                                toast.success("Copied to clipboard");
                                            }}>
                                                <Copy className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        <CommandBlock
                                            label="Or use wget/curl on your server (link is single-use):"
                                            command={`wget -O dump.rdb "${downloadUrl}"`}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {currentStep === "stop" && (
                        <div className="space-y-4">
                            <h4 className="font-medium">Step 2: Stop the Redis Server</h4>
                            <p className="text-sm text-muted-foreground">
                                Before replacing the RDB file, you must stop the Redis server to prevent data corruption.
                            </p>

                            <div className="space-y-3">
                                <CommandBlock label="Systemd (Linux):" command="sudo systemctl stop redis" />
                                <CommandBlock label="Docker:" command="docker stop <redis-container>" />
                                <CommandBlock label="Redis CLI (Graceful shutdown):" command="redis-cli -a <password> SHUTDOWN SAVE" />
                            </div>

                            <Alert>
                                <AlertTriangle className="h-4 w-4" />
                                <AlertDescription className="text-sm">
                                    Make sure Redis is completely stopped before proceeding.
                                    You can verify by running: <code className="bg-muted px-1 rounded">redis-cli ping</code> (should fail)
                                </AlertDescription>
                            </Alert>
                        </div>
                    )}

                    {currentStep === "replace" && (
                        <div className="space-y-4">
                            <h4 className="font-medium">Step 3: Replace the RDB File</h4>
                            <p className="text-sm text-muted-foreground">
                                Copy the downloaded backup file to your Redis data directory, replacing the existing dump.rdb.
                            </p>

                            <div className="space-y-3">
                                <CommandBlock
                                    label="Linux (default path):"
                                    command={`sudo cp ~/Downloads/${file.name} /var/lib/redis/dump.rdb\nsudo chown redis:redis /var/lib/redis/dump.rdb`}
                                />
                                <CommandBlock
                                    label="Docker:"
                                    command={`docker cp ~/Downloads/${file.name} <container>:/data/dump.rdb`}
                                />
                            </div>

                            <Alert>
                                <AlertTriangle className="h-4 w-4" />
                                <AlertDescription className="text-sm">
                                    <strong>Important:</strong> The file must be named exactly <code className="bg-muted px-1 rounded">dump.rdb</code>
                                    (or whatever is configured in your redis.conf as <code className="bg-muted px-1 rounded">dbfilename</code>).
                                </AlertDescription>
                            </Alert>
                        </div>
                    )}

                    {currentStep === "start" && (
                        <div className="space-y-4">
                            <h4 className="font-medium">Step 4: Start the Redis Server</h4>
                            <p className="text-sm text-muted-foreground">
                                Start Redis again. It will automatically load the new RDB file on startup.
                            </p>

                            <div className="space-y-3">
                                <CommandBlock label="Systemd (Linux):" command="sudo systemctl start redis" />
                                <CommandBlock label="Docker:" command="docker start <redis-container>" />
                            </div>

                            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-md">
                                <p className="text-sm text-green-600 dark:text-green-400">
                                    Check the Redis logs to ensure no errors occurred during startup and RDB loading.
                                </p>
                            </div>
                        </div>
                    )}

                    {currentStep === "verify" && (
                        <div className="space-y-4">
                            <h4 className="font-medium">Step 5: Verify the Restore</h4>
                            <p className="text-sm text-muted-foreground">
                                Confirm that your data has been restored correctly.
                            </p>

                            <div className="space-y-3">
                                <CommandBlock
                                    label="Check connection and key count:"
                                    command="redis-cli -a <password> INFO keyspace"
                                />
                                <CommandBlock
                                    label="Sample some keys:"
                                    command='redis-cli -a <password> KEYS "*" | head -20'
                                />
                            </div>

                            <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-md">
                                <CheckCircle2 className="h-8 w-8 text-green-500" />
                                <div>
                                    <p className="font-medium text-green-600 dark:text-green-400">Almost done!</p>
                                    <p className="text-sm text-muted-foreground">
                                        If your keys are visible and data looks correct, the restore was successful.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Navigation */}
            <Card>
                <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                        <div>
                            {currentStep === "intro" ? (
                                <Button variant="outline" onClick={onCancel}>
                                    <ArrowLeft className="h-4 w-4 mr-2" />
                                    Back to Storage
                                </Button>
                            ) : (
                                <Button variant="ghost" onClick={goToPrevStep}>
                                    <ArrowLeft className="h-4 w-4 mr-2" />
                                    Back
                                </Button>
                            )}
                        </div>
                        <div className="flex gap-2">
                            {currentStep !== "verify" && (
                                <Button onClick={goToNextStep}>
                                    {currentStep === "intro" ? "Start Wizard" : "I've Completed This Step"}
                                    <ChevronRight className="h-4 w-4 ml-1" />
                                </Button>
                            )}
                            {currentStep === "verify" && (
                                <Button onClick={onCancel} className="bg-green-600 hover:bg-green-700">
                                    <CheckCircle2 className="h-4 w-4 mr-2" />
                                    Complete Restore
                                </Button>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
