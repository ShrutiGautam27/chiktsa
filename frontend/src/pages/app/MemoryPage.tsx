import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Brain, FileText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/common";
import { useAskMemory, type MemoryResult } from "@/hooks/ai-queries";
import { useCareContext } from "@/hooks/useCareContext";
import { errorMessage } from "@/lib/api";
import type { Senior } from "@/lib/types";
import { EngineBadge } from "@/features/ai/components";
import { NeedsSenior, ProfilePicker, fmt } from "@/features/care/shared";

const EXAMPLES = ["When was the last doctor visit?", "What did the cardiologist say?", "Who verified the blood pressure medicine?", "How has sleep been recently?"];

function Ask({ hid, senior }: { hid: string; senior: Senior }) {
  const ask = useAskMemory(hid, senior.id);
  const [q, setQ] = useState("");
  const [history, setHistory] = useState<{ q: string; r: MemoryResult }[]>([]);
  const submit = (question = q) => {
    if (question.trim().length < 3) return;
    ask.mutate(question.trim(), { onSuccess: (r) => { setHistory([{ q: question.trim(), r }, ...history]); setQ(""); }, onError: (e) => toast.error(errorMessage(e)) });
  };
  return (
    <div className="space-y-6">
      <Card><CardContent className="p-5">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex gap-2">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-300" aria-hidden />
            <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask about ${senior.preferredName || senior.fullName}'s care history…`} aria-label="Question" maxLength={500} /></div>
          <Button type="submit" loading={ask.isPending} disabled={q.trim().length < 3}>Ask</Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">{EXAMPLES.map((e) => <button key={e} onClick={() => submit(e)} className="rounded-full border border-line px-3 py-1 text-xs text-ink-700 hover:bg-sage-50">{e}</button>)}</div>
        <p className="mt-3 text-xs text-ink-500">Answers come only from records you're allowed to see, with links to each source. If something isn't recorded, Chiktsa says so. Medical questions are referred to a professional.</p>
      </CardContent></Card>
      {history.map(({ q: question, r }, i) => (
        <Card key={i}><CardContent className="space-y-3 p-5">
          <p className="text-sm font-medium text-ink-500">{question}</p>
          {r.clinicalEscalation && <p className="flex items-start gap-2 rounded-xl bg-warning-50 p-3 text-sm text-warning-600"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> Medical questions need a professional.</p>}
          <p className="whitespace-pre-wrap">{r.answer}</p>
          {r.citations.length > 0 && <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">Sources</p>
            <ul className="space-y-1.5">{r.citations.map((c) => (
              <li key={c.id}><Link to={c.link} className="flex items-start gap-2 rounded-lg border border-line p-2.5 text-sm hover:bg-sage-50">
                <FileText className="mt-0.5 size-4 shrink-0 text-brand-600" />
                <span className="min-w-0"><span className="font-medium">{c.title}</span> <Badge tone="neutral" className="ml-1">{c.type}</Badge>
                  <span className="block text-xs text-ink-500">{c.date ? fmt(c.date, undefined, { dateStyle: "medium" }) : ""} — {c.snippet}</span></span>
              </Link></li>))}</ul>
          </div>}
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500"><EngineBadge engine={r.engine} /> {r.note}</div>
        </CardContent></Card>
      ))}
    </div>
  );
}

export function MemoryPage() {
  const { membership } = useCareContext();
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="AI Care Memory" description="Ask questions about past visits, observations, medicines and handovers — every answer links back to its source." />
      <ProfilePicker />
      <NeedsSenior>{(hid, senior) => <Ask key={senior.id} hid={hid} senior={senior} />}</NeedsSenior>
    </>
  );
}

export { Brain };
