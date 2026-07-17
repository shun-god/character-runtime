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

const stateEffectSchema = z.object({
  energy: z.number().int().min(-2).max(2),
  affinity: z.number().int().min(-2).max(2),
  mood: moodSchema,
});

const runtimeOutputFields = {
  event_summary: z.string(),
  state_effect: stateEffectSchema,
};

export const runtimeOutputSchema = z.union([
  z.object({
    ...runtimeOutputFields,
    action_intent: z.object({ type: z.literal("respond") }),
    speech: z.string(),
    micro_reaction: z.string().nullable(),
  }),
  z.object({
    ...runtimeOutputFields,
    action_intent: z.object({ type: z.literal("wait") }),
    speech: z.null(),
    micro_reaction: z.string().nullable(),
  }),
  z.object({
    ...runtimeOutputFields,
    action_intent: z.object({ type: z.literal("show_reaction") }),
    speech: z.null(),
    micro_reaction: z.string(),
  }),
]);

export type CharacterSpec = z.infer<typeof characterSpecSchema>;
export type Mood = z.infer<typeof moodSchema>;
export type RuntimeOutput = z.infer<typeof runtimeOutputSchema>;
