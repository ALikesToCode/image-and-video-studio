"use client";

import { useRef, useState } from "react";
import type { StoredMedia } from "@/lib/types";
import { exportGalleryBackup, MAX_GALLERY_BACKUP_BYTES } from "@/lib/gallery-backup";
import { Button } from "./ui/button";

export function GalleryBackupControls({ visibleItems, totalCount, onClear, onImport }: {
  visibleItems: StoredMedia[]; totalCount: number;
  onClear: () => Promise<void>; onImport: (text: string) => Promise<number>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<string>) => {
    setBusy(true); setError(null); setMessage(null);
    try { setMessage(await action()); }
    catch (error) { setError(error instanceof Error ? error.message : "Gallery operation failed."); }
    finally { setBusy(false); }
  };
  const exportBackup = () => run(async () => {
    const text = await exportGalleryBackup(visibleItems);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "studio-gallery-backup.json";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return `Exported ${visibleItems.length} assets with embedded media.`;
  });
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={busy || !visibleItems.length} onClick={() => void exportBackup()}>Export backup ({visibleItems.length})</Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>Import backup</Button>
      <Button variant="outline" size="sm" disabled={busy || !totalCount} onClick={() => {
        if (window.confirm(`Clear all ${totalCount} gallery assets? Saved references will be kept.`)) void run(async () => { await onClear(); return "Gallery cleared. Saved references were kept."; });
      }}>Clear Gallery</Button>
      <input ref={input} type="file" accept="application/json,.json" className="hidden" aria-label="Import gallery backup" disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void run(async () => {
          if (file.size > MAX_GALLERY_BACKUP_BYTES) throw new Error("Gallery backups must be 64 MB or smaller.");
          const count = await onImport(await file.text());
          return `Imported ${count} assets. Existing IDs were skipped.`;
        });
      }} />
    </div>
    <p className="text-xs text-muted-foreground">Backups include media and prompts. Up to 64 MB per file; export fewer assets using the filters.</p>
    {busy && <p role="status" className="text-xs text-muted-foreground">Working on gallery…</p>}
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
