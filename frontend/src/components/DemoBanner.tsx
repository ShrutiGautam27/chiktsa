import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { createAdapter, demoMode } from "@/lib/auth-adapters";

/** Visible notice on the public demo deployment: sample data, resets, not for real care records. */
export function DemoBanner() {
  const [demo, setDemo] = useState(demoMode);
  useEffect(() => { createAdapter().then(() => setDemo(demoMode)).catch(() => undefined); }, []);
  if (!demo) return null;
  return (
    <div role="note" className="flex items-center justify-center gap-2 bg-champagne-100 px-4 py-1.5 text-center text-xs text-champagne-700">
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      Demo deployment with sample households — data resets periodically. Please don't enter real medical information.
    </div>
  );
}

export function DemoAccounts() {
  const [demo, setDemo] = useState(demoMode);
  useEffect(() => { createAdapter().then(() => setDemo(demoMode)).catch(() => undefined); }, []);
  if (!demo) return null;
  return (
    <div className="mb-6 rounded-xl border border-champagne-300 bg-champagne-50 p-4 text-sm text-ink-700">
      <p className="font-semibold">Try the demo</p>
      <p className="mt-1">Password for all demo accounts: <code className="rounded bg-surface px-1">CareHubDemo2026</code></p>
      <ul className="mt-2 space-y-0.5 text-xs">
        <li><code>ravi@example.com</code> — household owner</li>
        <li><code>anita@example.com</code> — caregiver in two households</li>
        <li><code>priya@example.com</code> — family administrator</li>
        <li><code>kamla@example.com</code> — senior (simplified Senior Mode)</li>
      </ul>
    </div>
  );
}
