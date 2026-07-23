import { z } from "zod";

import {
  cognitionOutputSchema,
  runtimeOutputSchema,
  stateEffectSchema,
  type CognitionOutput,
  type ReactionPresets,
} from "./schema.js";

const nonEmptyStringSchema = z.string().trim().min(1);

const responsePlanFields = {
  stance: nonEmptyStringSchema,
  should_advise: z.boolean(),
  should_ask_question: z.boolean(),
  response_length: z.enum(["none", "short", "medium"]),
};

const cognitionDraftFields = {
  perception: z.object({
    known_facts: z.array(nonEmptyStringSchema).min(1).max(3),
    unknowns: z.array(nonEmptyStringSchema).max(4),
  }),
  character_references: z.object({
    spec_items: z.array(nonEmptyStringSchema).max(2),
    principles: z.array(nonEmptyStringSchema).max(2),
  }),
};

const presetRuntimeOutputDraftSchema = z.object({
  event_summary: z.string(),
  state_effect: stateEffectSchema,
});

const generatedCognitionDraftSchema = z.object({
  ...cognitionDraftFields,
  response_plan: z.object({
    ...responsePlanFields,
    response_mode: z.literal("generated"),
    preset_id: z.null(),
  }),
  runtime_output: runtimeOutputSchema,
});

const silentCognitionDraftSchema = z
  .object({
    ...cognitionDraftFields,
    response_plan: z.object({
      ...responsePlanFields,
      response_mode: z.literal("silent"),
      preset_id: z.null(),
    }),
    runtime_output: runtimeOutputSchema,
  })
  .refine(({ runtime_output }) => runtime_output.action_intent.type !== "respond", {
    message: "silent response_mode cannot use respond",
    path: ["runtime_output", "action_intent", "type"],
  });

const presetCognitionDraftSchema = z.object({
  ...cognitionDraftFields,
  response_plan: z.object({
    ...responsePlanFields,
    response_mode: z.literal("preset"),
    preset_id: nonEmptyStringSchema,
  }),
  runtime_output: presetRuntimeOutputDraftSchema,
});

export const cognitionDraftSchema = z.union([
  generatedCognitionDraftSchema,
  silentCognitionDraftSchema,
  presetCognitionDraftSchema,
]);

export type CognitionDraft = z.infer<typeof cognitionDraftSchema>;

export function resolveCognitionDraft(
  draft: CognitionDraft,
  reactionPresets: ReactionPresets,
): CognitionOutput {
  if (draft.response_plan.response_mode !== "preset") {
    return cognitionOutputSchema.parse(draft);
  }

  const preset = reactionPresets.presets.find(
    ({ id }) => id === draft.response_plan.preset_id,
  );
  if (!preset) {
    throw new Error(`Unknown Reaction Preset: ${draft.response_plan.preset_id}`);
  }

  return cognitionOutputSchema.parse({
    ...draft,
    response_plan: {
      ...draft.response_plan,
      response_length:
        preset.action_intent.type === "respond" ? "short" : "none",
    },
    runtime_output: {
      event_summary: draft.runtime_output.event_summary,
      state_effect: draft.runtime_output.state_effect,
      action_intent: preset.action_intent,
      speech: preset.speech,
      micro_reaction: preset.micro_reaction,
    },
  });
}
