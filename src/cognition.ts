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
Do not state fatigue, emotions, or circumstances that are not present in the input as facts.
When interpretation requires inference, express it cautiously as uncertainty.
Return exactly one JSON object and no Markdown or other text.
Write all natural-language values in Japanese, specifically interpretation, action_intent, speech, and micro_reaction.
Keep the existing JSON key names in English, and do not mix English explanations or supplemental text into the Japanese values.
interpretation: the character's concise understanding of the event.
state_effect: integer energy and affinity deltas from -2 to 2, plus the character's mood after the event.
action_intent: one concise immediate action the character intends to take.
speech: concise words spoken in the character's speech style.
micro_reaction: one concise subtle physical or emotional reaction.
Do not add facts not supported by the input.`;

const runtimeOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    interpretation: { type: "string" },
    state_effect: {
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
    },
    action_intent: { type: "string" },
    speech: { type: "string" },
    micro_reaction: { type: "string" },
  },
  required: [
    "interpretation",
    "state_effect",
    "action_intent",
    "speech",
    "micro_reaction",
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
