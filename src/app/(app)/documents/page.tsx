import { db, tables } from "@/db";
import { loadFolders, queryDocuments } from "@/app/api/documents/docQuery";
import { DocumentsView } from "@/components/documents/DocumentsView";
import { localDay } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const [settingsRow] = await db.select().from(tables.settings).limit(1);
  const timezone = settingsRow?.timezone ?? "Europe/London";
  const today = localDay(new Date(), timezone);

  const [documents, folders] = await Promise.all([queryDocuments({ limit: 60 }), loadFolders()]);

  // "Filed today" is a local-calendar question, so it's answered here where the
  // timezone lives rather than in the browser.
  const filedTodayIds = documents
    .filter((doc) => doc.filedAt && localDay(new Date(doc.filedAt), timezone) === today)
    .map((doc) => doc.id);

  return (
    <DocumentsView
      documents={documents}
      folders={folders}
      filedTodayIds={filedTodayIds}
      today={today}
    />
  );
}
