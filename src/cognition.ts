import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import {
  runtimeOutputSchema,
  type CharacterSpec,
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

const SYSTEM_PROMPT = `You are the cognition engine for one fictional character.
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
Return exactly one JSON object and no Markdown or other text.
Write all natural-language values in Japanese, specifically event_summary, speech, and micro_reaction.
Keep the existing JSON key names in English, and do not mix English explanations or supplemental text into the Japanese values.
event_summary: summarize only directly observable facts from the event, such as what happened or what the user said, in one concise Japanese sentence. Do not include an action plan, action rationale, advice, system capabilities, non-physical constraints, the character's feelings, or user emotions and circumstances not explicitly stated in the input.
state_effect: integer energy and affinity deltas from -2 to 2, plus the character's mood after the event.
action_intent.type: choose exactly one of respond, wait, or show_reaction.
Choose respond only when the character needs to speak to the user. For respond, generate speech and set micro_reaction to a Japanese string or null when no reaction changes.
Choose wait when the character should remain silent and quietly wait. For wait, set speech to null and micro_reaction to a Japanese string or null.
Choose show_reaction when the character should remain silent and display only an on-screen avatar reaction. For show_reaction, set speech to null and generate micro_reaction in Japanese.
Do not add facts not supported by the input.`;

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

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function parseGeminiRuntimeOutput(text: string | undefined): RuntimeOutput {
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
    return runtimeOutputSchema.parse(parsed);
  } catch (error) {
    const details =
      error instanceof z.ZodError
        ? error.issues
            .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
            .join("; ")
        : errorMessage(error);
    throw new Error(`Gemini response does not match RuntimeOutput: ${details}`, {
      cause: error,
    });
  }
}

export class GeminiCognitionEngine implements CognitionEngine {
  readonly #client: GoogleGenAI;
  readonly #model: string;

  constructor(options: { apiKey: string; model?: string }) {
    this.#client = new GoogleGenAI({ apiKey: options.apiKey });
    this.#model = options.model ?? "gemini-3.1-flash-lite";
  }

  async process(input: CognitionInput): Promise<RuntimeOutput> {
    let response;
    try {
      response = await this.#client.models.generateContent({
        model: this.#model,
        contents: JSON.stringify(
          {
            character_spec: input.characterSpec,
            current_state: input.currentState,
            recent_memory: input.recentMemory,
            current_event: input.currentEvent,
          },
          null,
          2,
        ),
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseJsonSchema: runtimeOutputJsonSchema,
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

    return parseGeminiRuntimeOutput(responseText);
  }
}
