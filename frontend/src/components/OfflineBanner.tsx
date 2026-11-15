import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CloudOff, RefreshCw, TriangleAlert, X } from "lucide-react";
import { clearResults, flush, getLastResults, getQueue, subscribe } from "@/lib/offline";

/** Shows offline status, pending changes and sync conflicts; replays the queue when back online. */
export function OfflineBanner() {
  const qc = useQueryClient();
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const queue = useSyncExternalStore(subscribe, () => JSON.stringify(getQueue()));
  const results = useSyncExternalStore(subscribe, () => JSON.stringify(getLastResults()));
  const pending = JSON.parse(queue) as unknown[];
  const issues = JSON.parse(results) as { clientOpId: string; status: string; message: string }[];

  useEffect(() => {
    const sync = async () => {
      const r = await flush();
      if (r.length) {
        const applied = r.filter((x) => x.status === "applied").length;
        if (applied) toast.success(`${applied} offline change(s) synced`);
        if (r.some((x) => x.status !== "applied")) toast.warning("Some offline changes need your attention");
        qc.invalidateQueries();
      }
    };
    const on = () => { setOnline(true); sync(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    sync();
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [qc]);

  if (online && !pending.length && !issues.length) return null;
  return (
    <div role="status" aria-live="polite" className="border-b border-line bg-champagne-50 px-4 py-2 text-sm sm:px-6">
      {(!online || pending.length > 0) && (
        <p className="flex flex-wrap items-center gap-2">
          <CloudOff className="size-4 text-champagne-700" aria-hidden />
          {online ? "Back online — syncing" : "You're offline."} {pending.length > 0 && `${pending.length} change(s) saved on this device will sync automatically.`}
          {online && pending.length > 0 && <button className="inline-flex items-center gap-1 text-brand-700 underline" onClick={() => flush().then(() => qc.invalidateQueries())}><RefreshCw className="size-3" /> Sync now</button>}
        </p>
      )}
      {issues.length > 0 && (
        <div className="mt-1 flex items-start gap-2 text-warning-600">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <ul className="flex-1 space-y-0.5">{issues.map((i) => <li key={i.clientOpId}>{i.message}</li>)}</ul>
          <button onClick={clearResults} aria-label="Dismiss sync messages" className="rounded p-0.5 hover:bg-warning-50"><X className="size-4" /></button>
        </div>
      )}
    </div>
  );
}
