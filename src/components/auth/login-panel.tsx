"use client";

import Image from "next/image";
import { Icon } from "@iconify/react";
import githubIcon from "@iconify-icons/simple-icons/github";
import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LoginAdapters } from "@/services/auth/login-page-service";
import { LogoRows } from "./logo-rows";

const GUIDES_URL = "https://docs.dbackup.app";
const GITHUB_URL = "https://github.com/Skyfay/DBackup";

interface LoginLookProps {
    /** The name under General, DBackup without one. */
    instanceName: string | null;
    /** The picture of the instance, the logos of the adapters without one. */
    picture: { src: string } | null;
    adapters: LoginAdapters;
}

/** The DBackup logo, filling up once on the first load like a backup that runs. Full at once with Reduce motion. */
function BrandLogo({ small = false }: { small?: boolean }) {
    const size = small ? 26 : 32;
    return (
        <span className={cn("relative inline-flex shrink-0", small ? "size-6.5" : "size-8")}>
            <Image src="/logo.svg" alt="" width={size} height={size} priority className="absolute inset-0 opacity-15" aria-hidden="true" />
            <Image src="/logo.svg" alt="DBackup" width={size} height={size} priority className="relative motion-safe:animate-[login-fill_0.9s_ease-out_both]" />
        </span>
    );
}

function Links({ className }: { className?: string }) {
    const link = "inline-flex items-center gap-1.5 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50";
    return (
        <div className={cn("flex items-center gap-5 text-xs font-medium", className)}>
            <a href={GUIDES_URL} target="_blank" rel="noopener noreferrer" className={link}>
                <BookOpen className="size-3.5" aria-hidden="true" />
                Guides
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={link}>
                <Icon icon={githubIcon} className="size-3.5" aria-hidden="true" />
                DBackup on GitHub
            </a>
        </div>
    );
}

/** The picture behind the text, darkened on top and at the foot so the text stays readable. */
function Picture({ src }: { src: string }) {
    return (
        <>
            {/* The picture comes from the database through its own route, not from a static file. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.35)_0%,transparent_30%,transparent_45%,rgba(0,0,0,0.72)_100%)]" aria-hidden="true" />
        </>
    );
}

/** The left of the login page from lg up: the logo, the logos of the adapters or the picture, the name and the links. */
function Panel({ instanceName, picture, adapters }: LoginLookProps) {
    return (
        <aside className={cn("relative hidden w-[44%] max-w-210 shrink-0 flex-col overflow-hidden border-r px-16 py-14 lg:sticky lg:top-0 lg:flex lg:h-svh", picture ? "bg-black text-white" : "login-tint bg-card")}>
            {picture && <Picture src={picture.src} />}
            <div className="relative flex items-center gap-2.5">
                <BrandLogo />
                <span className="text-lg font-semibold tracking-tight">DBackup</span>
            </div>
            <div className="relative flex flex-1 flex-col justify-center">{!picture && <LogoRows adapters={adapters} className="-mx-16" />}</div>
            <div className="relative">
                <p className="text-[2.75rem] leading-tight font-semibold tracking-tight">{instanceName ?? "DBackup"}</p>
                <p className={cn("mt-2.5 max-w-md text-[15px] leading-relaxed", picture ? "text-white/80" : "text-muted-foreground")}>
                    Self-hosted backups of your databases and files.
                </p>
                <Links className={cn("mt-7", picture ? "text-white/80" : "text-muted-foreground")} />
            </div>
        </aside>
    );
}

/** The same on a phone, as a banner on top with one row of logos. */
function Banner({ instanceName, picture, adapters }: LoginLookProps) {
    return (
        <header className={cn("relative overflow-hidden border-b px-6 pt-8 pb-6 lg:hidden", picture ? "bg-black text-white" : "login-tint bg-card")}>
            {picture && <Picture src={picture.src} />}
            <div className="relative flex items-center gap-2">
                <BrandLogo small />
                <span className="font-semibold tracking-tight">DBackup</span>
            </div>
            {!picture && <LogoRows adapters={adapters} single className="relative -mx-6 mt-5" />}
            <p className={cn("relative text-2xl font-semibold tracking-tight", picture ? "mt-20" : "mt-4")}>{instanceName ?? "DBackup"}</p>
        </header>
    );
}

/**
 * The frame of the login page: the instance on the left with the logos of every adapter or its own
 * picture, and the step on the right, which sets its own width. A phone gets the left as a banner.
 */
export function LoginLayout({ children, ...look }: LoginLookProps & { children: React.ReactNode }) {
    return (
        <div className="flex min-h-svh flex-col bg-page lg:flex-row">
            <Panel {...look} />
            <Banner {...look} />
            <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8">
                {children}
                <Links className="mt-10 text-muted-foreground lg:hidden" />
            </main>
        </div>
    );
}
