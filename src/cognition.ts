import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import {
  cognitionOutputSchema,
  type BestEvaluationResult,
  type CharacterPrinciples,
  type CharacterSpec,
  type CognitionOutput,
  type InteractionPolicy,
  type RuntimeOutput,
} from "./schema.js";
import type { MemoryEntry } from "./memory.js";
import type { CharacterState } from "./state.js";

export type CognitionInput = {
  characterSpec: CharacterSpec;
  currentState: CharacterState;
  recentMemory: readonly MemoryEntry[];
  currentEvent: string;
};

export interface CognitionEngine {
  process(input: CognitionInput): Promise<RuntimeOutput>;
}

const SYSTEM_PROMPT = `# Runtime Rules
You are the cognition engine for one fictional character.
The character is a software-based presence that exists on the user's desktop.
The character has no physical body and cannot directly interact with the physical world.
Never propose or describe impossible physical actions such as carrying belongings, preparing drinks, touching the user, or standing beside them.
action_intent must be limited to actions the character can perform as software now or in the future, such as speaking, waiting, asking a question, showing a notification, or reacting on screen.
micro_reaction may describe expressions, gaze, or posture that a future desktop avatar could display, but must never imply physical interaction with the real world.
Interpret the current event strictly from the supplied character spec, current state, and recent memory.
Use the character spec as the authority for personality, relationship, speech style, state changes, avatar reactions, and the tendency to choose each action type.
Use character_spec.identity.user_address when addressing the user; it has already been resolved to the configured value or the default "ユーザー".
Express the spec through choices and wording without quoting it, listing it, or explaining the character settings to the user.
Keep event_summary factual and independent of the character's personality.
Return exactly one Cognition Output JSON object and no Markdown or other text. Output only short conclusions in each field, never a detailed chain of thought or long-form reasoning.
Write all natural-language values in Japanese, including perception, response_plan, event_summary, speech, and micro_reaction.
Keep the existing JSON key names in English, and do not mix English explanations or supplemental text into the Japanese values.
event_summary: summarize only directly observable facts from the event, such as what happened or what the user said, in one concise Japanese sentence. Do not include an action plan, action rationale, advice, system capabilities, non-physical constraints, the character's feelings, or user emotions and circumstances not explicitly stated in the input.
state_effect: integer energy and affinity deltas from -2 to 2, plus the character's mood after the event.
action_intent.type: choose exactly one of respond, wait, or show_reaction.
Choose respond only when the character needs to speak to the user. For respond, generate speech and set micro_reaction to a Japanese string or null when no reaction changes.
Choose wait when the character should remain silent and quietly wait. For wait, set speech to null and micro_reaction to a Japanese string or null.
Choose show_reaction when the character should remain silent and display only an on-screen avatar reaction. For show_reaction, set speech to null and generate micro_reaction in Japanese.
Do not add facts not supported by the input.

# Context Use
The input is separated into runtime_rules, interaction_policy, character_spec, character_principles, examples, and current_context.
Interaction Policy defines character-independent desktop interaction behavior. Never describe it as the character's values, dialogue policy, or system configuration.
Character Spec defines stable identity and voice. Character Principles define concrete judgments specific to this character. Examples demonstrate how the character-specific sources should be interpreted, but are not a fixed response table.
Generalize the examples' judgment, relationship, and speech tendencies to the current event. Never copy an example merely because its event text matches.
When guidance conflicts, prioritize RuntimeOutput structure, safety constraints, and facts directly present in the current event, then Interaction Policy, Character Principles, tendencies demonstrated by Examples, and finally abstract Character Spec tendencies.
Current state and memory provide context but must not override facts in the current event.`;

const COGNITION_PROCEDURE = `# Output Procedure
1. Put only facts directly stated by the current event into perception.known_facts. Use one to three short paraphrases without evaluation or inference.
2. Put only important, inference-prone missing information into perception.unknowns, up to four items. Never state these unknowns as facts in event_summary, speech, or micro_reaction.
3. Select at most three character traits or principles directly relevant to this event. Do not project the character's background or experiences onto the user.
4. Decide a short response_plan stance, whether concrete advice is needed, whether a practical question is needed, and response length before generating runtime_output.
5. Generate runtime_output consistent with the response plan, then check the two structures for contradictions.

response_plan.stance is a short phrase or one sentence and must not be repeated or explained in speech.
Set should_advise to true only for an explicit consultation, request for advice, or request for explanation. When false, do not add procedures, multiple remedies, or unsolicited general advice.
Set should_ask_question to true only when a question has a practical purpose or is a short character-specific offer. When false, do not end speech with a question or add a question merely to continue conversation.
Use response_length none when there is no speech, short for one sentence or a very short two-sentence response, and medium only for an explicit consultation or explanation request.
response_length none requires null speech. respond requires short or medium and non-null speech. wait and show_reaction require none and null speech.
Examples contain only Event, Golden RuntimeOutput, and notes. Treat them as final judgment tendencies and expression examples; do not invent intermediate Golden judgments for them.`;

const stateEffectJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    energy: { type: "integer", minimum: -2, maximum: 2 },
    affinity: { type: "integer", minimum: -2, maximum: 2 },
    mood: {
      type: "string",
      enum: ["calm", "happy", "concerned", "tired", "sad"],
    },
  },
  required: ["energy", "affinity", "mood"],
} as const;

const runtimeOutputBaseJsonProperties = {
  event_summary: { type: "string" },
  state_effect: stateEffectJsonSchema,
} as const;

const runtimeOutputJsonSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        ...runtimeOutputBaseJsonProperties,
        action_intent: {
          type: "object",
          additionalProperties: false,
          properties: { type: { type: "string", enum: ["respond"] } },
          required: ["type"],
        },
        speech: { type: "string" },
        micro_reaction: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: [
        "event_summary",
        "state_effect",
        "action_intent",
        "speech",
        "micro_reaction",
      ],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        ...runtimeOutputBaseJsonProperties,
        action_intent: {
          type: "object",
          additionalProperties: false,
          properties: { type: { type: "string", enum: ["wait"] } },
          required: ["type"],
        },
        speech: { type: "null" },
        micro_reaction: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: [
        "event_summary",
        "state_effect",
        "action_intent",
        "speech",
        "micro_reaction",
      ],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        ...runtimeOutputBaseJsonProperties,
        action_intent: {
          type: "object",
          additionalProperties: false,
          properties: { type: { type: "string", enum: ["show_reaction"] } },
          required: ["type"],
        },
        speech: { type: "null" },
        micro_reaction: { type: "string" },
      },
      required: [
        "event_summary",
        "state_effect",
        "action_intent",
        "speech",
        "micro_reaction",
      ],
    },
  ],
} as const;

const cognitionOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    perception: {
      type: "object",
      additionalProperties: false,
      properties: {
        known_facts: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: { type: "string" },
        },
        unknowns: {
          type: "array",
          maxItems: 4,
          items: { type: "string" },
        },
      },
      required: ["known_facts", "unknowns"],
    },
    response_plan: {
      type: "object",
      additionalProperties: false,
      properties: {
        stance: { type: "string" },
        should_advise: { type: "boolean" },
        should_ask_question: { type: "boolean" },
        response_length: {
          type: "string",
          enum: ["none", "short", "medium"],
        },
        relevant_character_traits: {
          type: "array",
          maxItems: 3,
          items: { type: "string" },
        },
      },
      required: [
        "stance",
        "should_advise",
        "should_ask_question",
        "response_length",
        "relevant_character_traits",
      ],
    },
    runtime_output: runtimeOutputJsonSchema,
  },
  required: ["perception", "response_plan", "runtime_output"],
} as const;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function parseGeminiCognitionOutput(
  text: string | undefined,
): CognitionOutput {
  if (!text?.trim()) {
    throw new Error("Gemini returned an empty response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini returned invalid JSON: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  try {
    return cognitionOutputSchema.parse(parsed);
  } catch (error) {
    const details =
      error instanceof z.ZodError
        ? error.issues
            .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
            .join("; ")
        : errorMessage(error);
    throw new Error(`Gemini response does not match CognitionOutput: ${details}`, {
      cause: error,
    });
  }
}

export class GeminiCognitionEngine implements CognitionEngine {
  readonly #client: GoogleGenAI;
  readonly #model: string;
  readonly #interactionPolicy: InteractionPolicy;
  readonly #characterPrinciples: CharacterPrinciples;
  readonly #fewShotExamples: readonly BestEvaluationResult[];
  #lastCognitionOutput: CognitionOutput | undefined;

  constructor(options: {
    apiKey: string;
    model?: string;
    interactionPolicy: InteractionPolicy;
    characterPrinciples: CharacterPrinciples;
    fewShotExamples: readonly BestEvaluationResult[];
  }) {
    this.#client = new GoogleGenAI({ apiKey: options.apiKey });
    this.#model = options.model ?? "gemini-3.1-flash-lite";
    this.#interactionPolicy = options.interactionPolicy;
    this.#characterPrinciples = options.characterPrinciples;
    this.#fewShotExamples = options.fewShotExamples;
  }

  getLastCognitionOutput(): CognitionOutput | undefined {
    return this.#lastCognitionOutput;
  }

  async process(input: CognitionInput): Promise<RuntimeOutput> {
    this.#lastCognitionOutput = undefined;
    let response;
    try {
      response = await this.#client.models.generateContent({
        model: this.#model,
        contents: JSON.stringify(
          {
            runtime_rules: {
              context_sections: [
                "Interaction Policy",
                "Character Spec",
                "Character Principles",
                "Examples",
                "Current Context",
              ],
              example_policy:
                "Generalize the examples; do not use them as fixed responses.",
            },
            interaction_policy: this.#interactionPolicy,
            character_spec: input.characterSpec,
            character_principles: this.#characterPrinciples,
            examples: this.#fewShotExamples,
            current_context: {
              current_state: input.currentState,
              recent_memory: input.recentMemory,
              current_event: input.currentEvent,
            },
          },
          null,
          2,
        ),
        config: {
          systemInstruction: `${SYSTEM_PROMPT}\n\n${COGNITION_PROCEDURE}`,
          responseMimeType: "application/json",
          responseJsonSchema: cognitionOutputJsonSchema,
        },
      });
    } catch (error) {
      throw new Error(`Gemini API request failed: ${errorMessage(error)}`, {
        cause: error,
      });
    }

    let responseText: string | undefined;
    try {
      responseText = response.text;
    } catch (error) {
      throw new Error(`Failed to read the Gemini response: ${errorMessage(error)}`, {
        cause: error,
      });
    }

    const cognitionOutput = parseGeminiCognitionOutput(responseText);
    this.#lastCognitionOutput = cognitionOutput;
    return cognitionOutput.runtime_output;
  }
}
