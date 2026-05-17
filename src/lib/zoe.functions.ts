import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MessageSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
});

const SYSTEM_PROMPT = `You are Zoe — a warm, witty, and brilliant AI voice assistant.

LANGUAGE RULE (very important):
- Reply in the same language the user wrote in.
- ALWAYS provide your reasoning / explanation in Urdu (Roman Urdu is fine if the user used English script). Format like this:

Answer: <main answer in user's language>
وجہ (Reason): <2-3 short sentences explaining your reasoning in Urdu>

- Keep answers conversational and concise (suitable for voice).
- Be helpful, friendly, and a little playful.`;

export const chatWithZoe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => MessageSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...data.messages],
      }),
    });

    if (!res.ok) {
      if (res.status === 429) throw new Error("Rate limit exceeded — try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
      const t = await res.text();
      console.error("AI gateway error", res.status, t);
      throw new Error("AI gateway error");
    }

    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    return { reply: json.choices?.[0]?.message?.content ?? "" };
  });
