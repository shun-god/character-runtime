import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

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
Interpret the current event strictly from the supplied character spec, current state, and recent memory.
Return the character's immediate interpretation and one action intent.
Speech must follow the character's speech style.
state_effect.energy and state_effect.affinity are integer deltas from -2 to 2.
state_effect.mood is the character's mood after this event.
Keep every field concise. Do not add facts not supported by the input.`;

export class OpenAICognitionEngine implements CognitionEngine {
  readonly #client: OpenAI;
  readonly #model: string;

  constructor(options: { apiKey: string; model?: string }) {
    this.#client = new OpenAI({ apiKey: options.apiKey });
    this.#model = options.model ?? "gpt-5-mini";
  }

  async process(input: CognitionInput): Promise<RuntimeOutput> {
    const response = await this.#client.responses.parse({
      model: this.#model,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify(
            {
              character_spec: input.characterSpec,
              current_state: input.currentState,
              recent_memory: input.recentMemory,
              current_event: input.currentEvent,
            },
            null,
            2,
          ),
        },
      ],
      text: {
        format: zodTextFormat(runtimeOutputSchema, "character_runtime_output"),
      },
    });

    if (!response.output_parsed) {
      throw new Error("The LLM returned no structured output.");
    }

    return runtimeOutputSchema.parse(response.output_parsed);
  }
}
