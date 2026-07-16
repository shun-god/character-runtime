import { z } from "zod";

export const moodSchema = z.enum([
  "calm",
  "happy",
  "concerned",
  "tired",
  "sad",
]);

export const characterSpecSchema = z.object({
  identity: z.object({
    name: z.string(),
    role: z.string(),
  }),
  personality: z.array(z.string()),
  values: z.array(z.string()),
  speech_style: z.object({
    language: z.string(),
    tone: z.string(),
    user_address: z.string(),
  }),
});

export const runtimeOutputSchema = z.object({
  interpretation: z.string(),
  state_effect: z.object({
    energy: z.number().int().min(-2).max(2),
    affinity: z.number().int().min(-2).max(2),
    mood: moodSchema,
  }),
  action_intent: z.string(),
  speech: z.string(),
  micro_reaction: z.string(),
});

export type CharacterSpec = z.infer<typeof characterSpecSchema>;
export type Mood = z.infer<typeof moodSchema>;
export type RuntimeOutput = z.infer<typeof runtimeOutputSchema>;
