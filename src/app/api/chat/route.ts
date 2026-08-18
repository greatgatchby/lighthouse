import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { claude, FALLBACK_BETAS, FALLBACKS, logUsage, MODEL } from "@/lib/claude/client";
import { buildStableContext, buildVolatileContext } from "@/lib/claude/context";
import { SYSTEM_PROMPT } from "@/lib/claude/prompts";
import { buildTools } from "@/lib/claude/tools";

export const dynamic = "force-dynamic";

// SSE chat endpoint. Events:
//   {type:"chat", chatId}         — chat id (new or existing), first event
//   {type:"text", delta}          — streamed assistant text
//   {type:"tool", name}           — a tool ran this iteration
//   {type:"confirmation", ...}    — money guardrail card to render
//   {type:"done"}                 — turn complete
//   {type:"error", message}

export async function POST(request: Request) {
  await requireUserId();
  const { chatId: incomingChatId, message } = await request.json();
  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  let chatId: string = incomingChatId;
  if (chatId) {
    const [existing] = await db
      .select({ id: tables.chats.id })
      .from(tables.chats)
      .where(eq(tables.chats.id, chatId))
      .limit(1);
    if (!existing) chatId = "";
  }
  if (!chatId) {
    const [chat] = await db
      .insert(tables.chats)
      .values({ title: message.slice(0, 80) })
      .returning({ id: tables.chats.id });
    chatId = chat.id;
  }

  const history = await db
    .select()
    .from(tables.chatMessages)
    .where(eq(tables.chatMessages.chatId, chatId))
    .orderBy(asc(tables.chatMessages.createdAt));

  await db.insert(tables.chatMessages).values({ chatId, role: "user", content: message });

  const [stable, volatile] = await Promise.all([buildStableContext(), buildVolatileContext()]);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // client went away — keep running so tool side-effects complete
        }
      };

      send({ type: "chat", chatId });

      try {
        const runner = claude().beta.messages.toolRunner({
          model: MODEL,
          max_tokens: 16000,
          stream: true,
          max_iterations: 12,
          betas: FALLBACK_BETAS,
          fallbacks: FALLBACKS,
          thinking: { type: "adaptive" },
          system: [
            {
              type: "text",
              // stable prefix — frozen prompt + slowly-changing context, cached 1h
              text: `${SYSTEM_PROMPT}\n\n# Their current world\n\n${stable}`,
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
            { type: "text", text: volatile },
          ],
          tools: buildTools({ emit: send }),
          messages: [
            ...history.map((m) => ({
              role: m.role,
              content:
                typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            })),
            { role: "user" as const, content: message },
          ],
        });

        let finalText = "";
        for await (const messageStream of runner) {
          messageStream.on("text", (delta: string) => send({ type: "text", delta }));
          const iterationMessage = await messageStream.finalMessage();
          await logUsage("chat", iterationMessage.usage);

          for (const block of iterationMessage.content) {
            if (block.type === "tool_use") send({ type: "tool", name: block.name });
            if (block.type === "text") finalText = block.text;
          }

          // the runner does not auto-resume paused server-tool turns
          if (iterationMessage.stop_reason === "pause_turn") {
            runner.pushMessages({ role: "assistant", content: iterationMessage.content });
          }
        }

        if (finalText) {
          await db
            .insert(tables.chatMessages)
            .values({ chatId, role: "assistant", content: finalText });
          await db
            .update(tables.chats)
            .set({ updatedAt: new Date() })
            .where(eq(tables.chats.id, chatId));
        }

        send({ type: "done" });
      } catch (err) {
        console.error("[chat]", err);
        send({
          type: "error",
          message: err instanceof Error ? err.message : "something went wrong",
        });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
