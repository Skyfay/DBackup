"use client";

import { useState } from "react";
import { Download, Terminal } from "lucide-react";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { madeAt } from "@/components/dashboard/storage/explorer/explorer-format";
import type { FileInfo } from "@/components/dashboard/storage/file-info";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { Notice, Section } from "./restore-parts";
import { LinkLine } from "@/components/dashboard/storage/download/link-line";
import { useDownloadLink } from "@/components/dashboard/storage/download/use-download-link";
import { AofSteps, FoldSection, GuideSteps } from "./redis-guide-parts";
import {
    codeLanguage,
    HOST_DEFAULTS,
    hostPlace,
    redisAofCommands,
    redisScript,
    redisSteps,
    runHint,
    scriptFileName,
    type RedisEngine,
    type RedisGuideInput,
    type RedisHost,
} from "./redis-guide-script";

const HOSTS: RedisHost[] = ["docker", "compose", "service", "windows"];

const HOST_TITLES: Record<RedisHost, string> = { docker: "Docker", compose: "Docker Compose", service: "Linux service", windows: "Windows service" };

/** The labels of the two fields, which name what the picked host calls them. */
const FIELDS: Record<RedisHost, { target: string; dataDir: string }> = {
    docker: { target: "Container", dataDir: "Data folder in the container" },
    compose: { target: "Service in the compose file", dataDir: "Data folder in the container" },
    service: { target: "Service", dataDir: "Data folder" },
    windows: { target: "Service", dataDir: "Data folder" },
};

type Mode = "script" | "manual";

interface RedisGuideProps {
    file: FileInfo;
    destinationId: string;
    engine: RedisEngine;
    /** Whether this user may download backups, which the one-time link needs. */
    canDownload: boolean;
}

/**
 * The restore of a Redis or Valkey backup. Redis reads a dump only while it starts, so this
 * runs by hand on the Redis host: one script written for where Redis runs, or the same
 * commands step by step, and what to do about an append only file.
 */
export function RedisGuide({ file, destinationId, engine, canDownload }: RedisGuideProps) {
    const { formatDate } = useDateFormatter();
    const link = useDownloadLink(destinationId, file.path);
    const [host, setHost] = useState<RedisHost>("docker");
    const [values, setValues] = useState(() => Object.fromEntries(HOSTS.map((each) => [each, HOST_DEFAULTS[each][engine]])) as Record<RedisHost, { target: string; dataDir: string }>);
    const [password, setPassword] = useState(true);
    const [mode, setMode] = useState<Mode>("script");

    const made = Date.parse(madeAt(file));
    const job = file.jobName ?? file.name;
    const input: RedisGuideInput = {
        engine,
        host,
        target: values[host].target,
        dataDir: values[host].dataDir,
        password,
        url: link.url,
        urlExpired: link.expired,
        backup: Number.isFinite(made) ? `${job} of ${formatDate(new Date(made), "Pp")}` : job,
    };
    const script = redisScript(input);
    const aof = redisAofCommands(input);
    const place = hostPlace(host, engine);
    const language = codeLanguage(host);
    const fileName = scriptFileName(job, host);

    const setValue = (key: "target" | "dataDir", value: string) => setValues((current) => ({ ...current, [host]: { ...current[host], [key]: value } }));

    const downloadScript = () => {
        // Windows PowerShell reads a file without a byte order mark as ANSI, which breaks any
        // name with an umlaut in it.
        const text = host === "windows" ? `﻿${script.code}\r\n` : `${script.code}\n`;
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    return (
        <>
            <Notice title={`${engine} reads a dump only while it starts`} tone="warning">
                So the restore runs on the {engine} host: stop it, swap the dump, start it. Everything in {engine} is replaced by this backup.
            </Notice>

            <Section title={`Where does ${engine} run?`} note="The commands below follow what you pick here.">
                <div className="space-y-4">
                    <ChoiceCards
                        value={host}
                        onValueChange={(value) => setHost(value as RedisHost)}
                        className="sm:grid-cols-2 lg:grid-cols-4"
                        aria-label={`Where ${engine} runs`}
                        options={HOSTS.map((value) => ({
                            value,
                            title: HOST_TITLES[value],
                            description: {
                                docker: `${engine} runs in a container of its own.`,
                                compose: `${engine} is a service of a compose file.`,
                                service: `systemd starts ${engine.toLowerCase()}-server on the host.`,
                                windows: `${engine} runs as a service on Windows Server.`,
                            }[value],
                        }))}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                        {(["target", "dataDir"] as const).map((key) => (
                            <div key={key} className="min-w-0 space-y-2">
                                <Label htmlFor={`redis-${key}`}>{FIELDS[host][key]}</Label>
                                <Input
                                    id={`redis-${key}`}
                                    value={values[host][key]}
                                    onChange={(event) => setValue(key, event.target.value)}
                                    placeholder={HOST_DEFAULTS[host][engine][key]}
                                    className="font-mono"
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </div>
                        ))}
                    </div>
                    <SwitchList>
                        <SwitchRow
                            title={`${engine} asks for a password`}
                            description="The commands ask for it when they run, so it is in no command and no history."
                            checked={password}
                            onCheckedChange={setPassword}
                        />
                    </SwitchList>
                </div>
            </Section>

            <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)} className="gap-0">
                <Section
                    title="Run the restore"
                    note={mode === "script"
                        ? `One script that checks ${engine} will read the dump, then stops it, swaps the dump, starts it and lists the keys.`
                        : "The same commands one at a time with every value filled in. Paste each block on its own."}
                    action={
                        <TabsList className="h-8" aria-label="How to run the restore">
                            <TabsTrigger value="script" className="px-2.5 text-xs">Script</TabsTrigger>
                            <TabsTrigger value="manual" className="px-2.5 text-xs">Manual</TabsTrigger>
                        </TabsList>
                    }
                >
                    <div className="space-y-4">
                        <LinkLine link={link} canDownload={canDownload} holder="the commands" plural onCreate={() => void link.create()} />
                        <TabsContent value="script" className="space-y-3">
                            <CodeBlock name={fileName} code={script.code} language={language} icon={<Terminal />} mark={script.marks} />
                            <div className="flex flex-wrap items-center gap-3">
                                <Button variant="outline" size="sm" onClick={downloadScript} className="flex-1 sm:flex-none">
                                    <Download />
                                    Download the script
                                </Button>
                                <p className="min-w-0 flex-1 text-xs text-muted-foreground">{runHint(input, fileName)}</p>
                            </div>
                        </TabsContent>
                        <TabsContent value="manual">
                            <GuideSteps steps={redisSteps(input)} place={place} language={language} engine={engine} canDownload={canDownload} onDownloadHere={() => void link.downloadHere()} />
                        </TabsContent>
                    </div>
                </Section>
            </Tabs>

            <FoldSection title={`If ${engine} writes an append only file`} note={`With appendonly yes ${engine} loads that file when it starts and never reads the dump. The script stops before it changes anything.`}>
                <AofSteps keep={aof.keep} turnOn={aof.turnOn} place={place} language={language} engine={engine} />
            </FoldSection>
        </>
    );
}
