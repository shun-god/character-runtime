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
    first_person: z.string(),
    user_address: z.string().default("ユーザー"),
  }),
  personality: z.array(z.string()),
  values: z.array(z.string()),
  relationship: z.object({
    user_role: z.string(),
    traits: z.array(z.string()),
  }),
  speech_style: z.object({
    language: z.string(),
    tone: z.string(),
    guidelines: z.array(z.string()),
  }),
  behavior_preferences: z.array(z.string()),
  background: z.array(z.string()).default([]),
});

const nonEmptyStringSchema = z.string().trim().min(1);

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

export const cognitionOutputSchema = z
  .object({
    perception: z.object({
      known_facts: z.array(nonEmptyStringSchema).min(1).max(3),
      unknowns: z.array(nonEmptyStringSchema).max(4),
    }),
    character_references: z.object({
      spec_items: z
        .array(nonEmptyStringSchema)
        .max(2)
        .refine((items) => new Set(items).size === items.length, {
          message: "Character Spec references must not contain duplicates",
        }),
      principles: z
        .array(nonEmptyStringSchema)
        .max(2)
        .refine((items) => new Set(items).size === items.length, {
          message: "Character Principle references must not contain duplicates",
        }),
    }),
    response_plan: z.object({
      stance: nonEmptyStringSchema,
      should_advise: z.boolean(),
      should_ask_question: z.boolean(),
      response_length: z.enum(["none", "short", "medium"]),
    }),
    runtime_output: runtimeOutputSchema,
  })
  .superRefine((value, context) => {
    const actionType = value.runtime_output.action_intent.type;
    const responseLength = value.response_plan.response_length;

    if (responseLength === "none" && value.runtime_output.speech !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtime_output", "speech"],
        message: "speech must be null when response_length is none",
      });
    }
    if (actionType === "respond" && responseLength === "none") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["response_plan", "response_length"],
        message: "respond requires short or medium response_length",
      });
    }
    if (actionType !== "respond" && responseLength !== "none") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["response_plan", "response_length"],
        message: "wait and show_reaction require none response_length",
      });
    }
  });

const principlesSchema = z.object({
  principles: z.array(nonEmptyStringSchema).min(1),
});

export const interactionPolicySchema = principlesSchema;
export const characterPrinciplesSchema = principlesSchema;

export const bestEvaluationResultSchema = z.object({
  event: nonEmptyStringSchema,
  output: runtimeOutputSchema,
  notes: z.array(nonEmptyStringSchema).min(1),
});

export const bestEvaluationSchema = z.object({
  evaluated_at: z.string().optional(),
  model: z.string().optional(),
  results: z.array(bestEvaluationResultSchema).min(1),
});

export type CharacterSpec = z.infer<typeof characterSpecSchema>;
export type Mood = z.infer<typeof moodSchema>;
export type RuntimeOutput = z.infer<typeof runtimeOutputSchema>;
export type CognitionOutput = z.infer<typeof cognitionOutputSchema>;
export type InteractionPolicy = z.infer<typeof interactionPolicySchema>;
export type CharacterPrinciples = z.infer<typeof characterPrinciplesSchema>;
export type BestEvaluation = z.infer<typeof bestEvaluationSchema>;
export type BestEvaluationResult = z.infer<typeof bestEvaluationResultSchema>;
