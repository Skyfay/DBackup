import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Nav } from "@/components/site/nav";
import { Footer } from "@/components/site/footer";
import { JsonLd } from "@/components/site/json-ld";
import { SITE_URL } from "@/lib/site";
import { GITHUB_REPO, DISCORD_URL, META_DESCRIPTION, SITE_TITLE } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The canonical stays with each page, so a page without its own never claims to be the home page.
const { alternates: _alternates, ...sharedMetadata } = pageMetadata("/");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s | DBackup",
  },
  description: META_DESCRIPTION,
  icons: {
    icon: "/favicon/favicon-32x32.png",
    apple: "/favicon/favicon-256x256.png",
  },
  openGraph: sharedMetadata.openGraph,
  twitter: sharedMetadata.twitter,
};

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "DBackup",
  url: SITE_URL,
  logo: `${SITE_URL}/logo.png`,
  sameAs: [`https://github.com/${GITHUB_REPO}`, DISCORD_URL],
};

const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "DBackup",
  url: SITE_URL,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col overflow-x-clip font-sans antialiased`}
      >
        <JsonLd data={ORGANIZATION_JSON_LD} />
        <JsonLd data={WEBSITE_JSON_LD} />
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <Nav />
            <main className="flex-1">{children}</main>
            <Footer />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
