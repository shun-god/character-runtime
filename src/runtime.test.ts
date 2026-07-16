import assert from "node:assert/strict";
import test from "node:test";

import {
  parseGeminiRuntimeOutput,
  type CognitionEngine,
  type CognitionInput,
} from "./cognition.js";
import { RecentMemory } from "./memory.js";
import { CharacterRuntime } from "./runtime.js";
import type { CharacterSpec, RuntimeOutput } from "./schema.js";

const spec: CharacterSpec = {
  identity: { name: "Mio", role: "companion" },
  personality: ["observant"],
  values: ["well-being"],
  speech_style: {
    language: "Japanese",
    tone: "soft",
    user_address: "プロデューサー",
  },
};

const output: RuntimeOutput = {
  interpretation: "The user seems tired.",
  state_effect: { energy: -2, affinity: 1, mood: "concerned" },
  action_intent: "stay_near_user",
  speech: "おかえり、プロデューサー。",
  micro_reaction: "small_smile",
};

class StubEngine implements CognitionEngine {
  readonly inputs: CognitionInput[] = [];

  async process(input: CognitionInput): Promise<RuntimeOutput> {
    this.inputs.push(input);
    return output;
  }
}

test("applies state effects and supplies updated state and memory next time", async () => {
  const engine = new StubEngine();
  const runtime = new CharacterRuntime(spec, engine);

  await runtime.processEvent("user returned home");
  assert.deepEqual(runtime.getState(), {
    energy: 3,
    affinity: 1,
    mood: "concerned",
  });

  await runtime.processEvent("user sat down");
  assert.equal(engine.inputs[1]?.currentState.energy, 3);
  assert.equal(engine.inputs[1]?.recentMemory.length, 1);
  assert.equal(engine.inputs[1]?.recentMemory[0]?.event, "user returned home");
});

test("clamps numeric state values to their allowed ranges", async () => {
  const runtime = new CharacterRuntime(spec, new StubEngine(), {
    initialState: { energy: 1, affinity: 10, mood: "calm" },
  });

  await runtime.processEvent("event");
  assert.deepEqual(runtime.getState(), {
    energy: 0,
    affinity: 10,
    mood: "concerned",
  });
});

test("recent memory keeps only the configured number of entries", () => {
  const memory = new RecentMemory(2);
  const state = { energy: 5, affinity: 0, mood: "calm" as const };

  for (const event of ["one", "two", "three"]) {
    memory.add({ event, output, state_after: state });
  }

  assert.deepEqual(
    memory.getAll().map((entry) => entry.event),
    ["two", "three"],
  );
});

test("parses and validates a structured Gemini response without network access", () => {
  assert.deepEqual(parseGeminiRuntimeOutput(JSON.stringify(output)), output);
});

test("rejects malformed or schema-invalid Gemini responses", () => {
  assert.throws(
    () => parseGeminiRuntimeOutput(""),
    /Gemini returned an empty response/,
  );
  assert.throws(
    () => parseGeminiRuntimeOutput("not json"),
    /Gemini returned invalid JSON/,
  );
  assert.throws(
    () => parseGeminiRuntimeOutput('{"interpretation":"missing fields"}'),
    /Gemini response does not match RuntimeOutput/,
  );
});
