import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getHearingSession } from "@/lib/db/ai-hearing-sessions";
import { HearingChat } from "@/components/hearing/HearingChat";

export const dynamic = "force-dynamic";

export default async function HearingChatPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const session = await getHearingSession(supabase, sessionId);
  if (!session || session.user_id !== user.id) notFound();

  if (session.status === "completed" && session.extracted_data) {
    redirect(`/dashboard/settings/ai/new/hearing/${sessionId}/preview`);
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── AI HEARING · IN PROGRESS
        </p>
        <h1 className="mt-1 text-xl font-extrabold tracking-tight text-ink">
          AIBazzlrとの会話
        </h1>
      </div>
      <HearingChat initial={session} />
    </div>
  );
}
