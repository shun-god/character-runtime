import assert from "node:assert/strict";
import test from "node:test";

import {
  parseGeminiRuntimeOutput,
  type CognitionEngine,
  type CognitionInput,
} from "./cognition.js";
import { RecentMemory } from "./memory.js";
import { CharacterRuntime } from "./runtime.js";
import {
  characterSpecSchema,
  type CharacterSpec,
  type RuntimeOutput,
} from "./schema.js";

const spec: CharacterSpec = {
  identity: {
    name: "篠澤広",
    role: "companion",
    first_person: "わたし",
    user_address: "プロデューサー",
  },
  personality: ["observant"],
  values: ["well-being"],
  relationship: {
    user_role: "producer",
    traits: ["equal relationship"],
  },
  speech_style: {
    language: "Japanese",
    tone: "soft",
    guidelines: ["avoid excessive formality"],
  },
  behavior_preferences: ["prefer waiting when uncertain"],
};

const output: RuntimeOutput = {
  event_summary: "ユーザーが帰宅した。",
  state_effect: { energy: -2, affinity: 1, mood: "concerned" },
  action_intent: { type: "respond" },
  speech: "おかえり、プロデューサー。",
  micro_reaction: "小さく微笑む",
};

const waitOutput: RuntimeOutput = {
  event_summary: "ユーザーがしばらく発話していない。",
  state_effect: { energy: 0, affinity: 0, mood: "calm" },
  action_intent: { type: "wait" },
  speech: null,
  micro_reaction: null,
};

const reactionOutput: RuntimeOutput = {
  event_summary: "ユーザーがこちらを見ている。",
  state_effect: { energy: 0, affinity: 0, mood: "calm" },
  action_intent: { type: "show_reaction" },
  speech: null,
  micro_reaction: "少し首を傾げる",
};

class StubEngine implements CognitionEngine {
  readonly inputs: CognitionInput[] = [];

  async process(input: CognitionInput): Promise<RuntimeOutput> {
    this.inputs.push(input);
    return output;
  }
}

class InvalidOutputEngine implements CognitionEngine {
  async process(): Promise<RuntimeOutput> {
    return parseGeminiRuntimeOutput(
      JSON.stringify({ ...output, speech: null }),
    );
  }
}

test("validates character specs and resolves the user address", () => {
  assert.equal(characterSpecSchema.parse(spec).identity.user_address, "プロデューサー");

  const { user_address: ignoredUserAddress, ...identityWithoutAddress } =
    spec.identity;
  const withoutAddress = {
    ...spec,
    identity: identityWithoutAddress,
  };
  assert.equal(
    characterSpecSchema.parse(withoutAddress).identity.user_address,
    "ユーザー",
  );

  const { name: ignoredName, ...identityWithoutName } = spec.identity;
  assert.throws(
    () =>
      characterSpecSchema.parse({
        ...spec,
        identity: identityWithoutName,
      }),
    /Required/,
  );
});

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

test("accepts valid structured responses without network access", () => {
  assert.deepEqual(parseGeminiRuntimeOutput(JSON.stringify(output)), output);
  assert.deepEqual(parseGeminiRuntimeOutput(JSON.stringify(waitOutput)), waitOutput);
  assert.deepEqual(
    parseGeminiRuntimeOutput(JSON.stringify(reactionOutput)),
    reactionOutput,
  );
});

test("rejects the old interpretation field and a missing event_summary", () => {
  const { event_summary, ...withoutSummary } = output;

  assert.throws(
    () =>
      parseGeminiRuntimeOutput(
        JSON.stringify({ ...withoutSummary, interpretation: event_summary }),
      ),
    /Gemini response does not match RuntimeOutput/,
  );
  assert.throws(
    () => parseGeminiRuntimeOutput(JSON.stringify(withoutSummary)),
    /Gemini response does not match RuntimeOutput/,
  );
});

test("rejects malformed or invalid action combinations", () => {
  assert.throws(
    () => parseGeminiRuntimeOutput(""),
    /Gemini returned an empty response/,
  );
  assert.throws(
    () => parseGeminiRuntimeOutput("not json"),
    /Gemini returned invalid JSON/,
  );
  assert.throws(
    () => parseGeminiRuntimeOutput('{"event_summary":"missing fields"}'),
    /Gemini response does not match RuntimeOutput/,
  );
  assert.throws(
    () =>
      parseGeminiRuntimeOutput(
        JSON.stringify({ ...output, speech: null }),
      ),
    /Gemini response does not match RuntimeOutput/,
  );
  assert.throws(
    () =>
      parseGeminiRuntimeOutput(
        JSON.stringify({ ...waitOutput, speech: "話しかける" }),
      ),
    /Gemini response does not match RuntimeOutput/,
  );
  assert.throws(
    () =>
      parseGeminiRuntimeOutput(
        JSON.stringify({ ...reactionOutput, micro_reaction: null }),
      ),
    /Gemini response does not match RuntimeOutput/,
  );
  assert.throws(
    () =>
      parseGeminiRuntimeOutput(
        JSON.stringify({ ...reactionOutput, speech: "話しかける" }),
      ),
    /Gemini response does not match RuntimeOutput/,
  );
});

test("does not update state or memory when cognition returns invalid output", async () => {
  const runtime = new CharacterRuntime(spec, new InvalidOutputEngine());

  await assert.rejects(
    runtime.processEvent("event"),
    /Gemini response does not match RuntimeOutput/,
  );
  assert.deepEqual(runtime.getState(), { energy: 5, affinity: 0, mood: "calm" });
  assert.deepEqual(runtime.getMemory(), []);
});
