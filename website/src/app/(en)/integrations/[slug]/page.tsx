import { DatabasePage, databaseMetadata, databasePageParams } from "@/components/pages/database-page";

export const dynamicParams = false;

export function generateStaticParams() {
  return databasePageParams();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return databaseMetadata("en", (await params).slug);
}

export default async function Database({ params }: { params: Promise<{ slug: string }> }) {
  return <DatabasePage locale="en" slug={(await params).slug} />;
}
