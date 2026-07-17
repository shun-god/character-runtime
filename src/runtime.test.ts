import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_CHARACTER_ID,
  resolveCharacterId,
  resolveCharacterPackageLocation,
  validateCharacterId,
} from "./character-selection.js";
import {
  parseGeminiCognitionOutput,
  type CognitionEngine,
  type CognitionInput,
} from "./cognition.js";
import {
  createCognitionResources,
  FEW_SHOT_EVENTS,
  loadCognitionResources,
  selectFewShotExamples,
} from "./cognition-context.js";
import { createGoldenReference } from "./golden-comparison.js";
import {
  createCognitionEvaluationFields,
  createEvaluationReport,
} from "./evaluation-report.js";
import { RecentMemory } from "./memory.js";
import { CharacterRuntime } from "./runtime.js";
import {
  bestEvaluationSchema,
  characterPrinciplesSchema,
  characterSpecSchema,
  cognitionOutputSchema,
  interactionPolicySchema,
  type CharacterSpec,
  type CognitionOutput,
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

const cognitionOutput: CognitionOutput = {
  perception: {
    known_facts: ["ユーザーが帰宅した"],
    unknowns: [],
  },
  response_plan: {
    stance: "簡潔に出迎える",
    should_advise: false,
    should_ask_question: false,
    response_length: "short",
    relevant_character_traits: ["落ち着いた口調"],
  },
  runtime_output: output,
};

const waitCognitionOutput: CognitionOutput = {
  perception: {
    known_facts: ["ユーザーがしばらく発話していない"],
    unknowns: ["沈黙の理由"],
  },
  response_plan: {
    stance: "静かに待つ",
    should_advise: false,
    should_ask_question: false,
    response_length: "none",
    relevant_character_traits: [],
  },
  runtime_output: waitOutput,
};

const reactionCognitionOutput: CognitionOutput = {
  perception: {
    known_facts: ["ユーザーがこちらを見ている"],
    unknowns: [],
  },
  response_plan: {
    stance: "画面上で小さく反応する",
    should_advise: false,
    should_ask_question: false,
    response_length: "none",
    relevant_character_traits: [],
  },
  runtime_output: reactionOutput,
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
    return parseGeminiCognitionOutput(
      JSON.stringify({
        ...cognitionOutput,
        runtime_output: { ...output, speech: null },
      }),
    ).runtime_output;
  }
}

test("resolves Character ID from argument, environment, and default", () => {
  const originalCharacterId = process.env.CHARACTER_ID;
  try {
    delete process.env.CHARACTER_ID;
    assert.equal(resolveCharacterId([], process.env), DEFAULT_CHARACTER_ID);

    process.env.CHARACTER_ID = "environment-character";
    assert.equal(resolveCharacterId([], process.env), "environment-character");
    assert.equal(
      resolveCharacterId(["--character", "argument-character"], process.env),
      "argument-character",
    );
    assert.equal(
      resolveCharacterId(["--character=inline-character"], process.env),
      "inline-character",
    );
  } finally {
    if (originalCharacterId === undefined) {
      delete process.env.CHARACTER_ID;
    } else {
      process.env.CHARACTER_ID = originalCharacterId;
    }
  }
});

test("validates Character IDs and resolves all package paths", () => {
  for (const id of ["hiro", "test-character", "character_01"]) {
    assert.equal(validateCharacterId(id), id);
  }
  for (const id of ["../hiro", "/hiro", "hiro/other", "", "has space", "C:\\hiro"]) {
    assert.throws(() => validateCharacterId(id), /Invalid character ID/);
  }

  assert.deepEqual(resolveCharacterPackageLocation("hiro"), {
    id: "hiro",
    directory: "characters/hiro",
    specPath: "characters/hiro/character-spec.json",
    principlesPath: "characters/hiro/character-principles.json",
    goldenEvaluationPath: "characters/hiro/best-evaluation.json",
  });
});

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

test("validates Interaction Policy", () => {
  assert.deepEqual(
    interactionPolicySchema.parse({ principles: ["  共通方針  "] }),
    { principles: ["共通方針"] },
  );
  assert.throws(
    () => interactionPolicySchema.parse({ principles: [] }),
    /at least 1 element/,
  );
  assert.throws(
    () => interactionPolicySchema.parse({ principles: "invalid" }),
    /Expected array/,
  );
});

test("validates Character Principles", () => {
  assert.deepEqual(
    characterPrinciplesSchema.parse({ principles: ["  固有原則  "] }),
    { principles: ["固有原則"] },
  );
  assert.throws(
    () => characterPrinciplesSchema.parse({ principles: [] }),
    /at least 1 element/,
  );
  assert.throws(
    () => characterPrinciplesSchema.parse({ principles: ["  "] }),
    /at least 1 character/,
  );
});

test("validates Golden Evaluation and reuses RuntimeOutput rules", () => {
  const valid = {
    results: [{ event: "event", output, notes: ["note"] }],
  };
  assert.deepEqual(bestEvaluationSchema.parse(valid).results[0]?.output, output);

  assert.throws(
    () =>
      bestEvaluationSchema.parse({
        results: [
          {
            event: "event",
            output: { ...output, speech: null },
            notes: ["note"],
          },
        ],
      }),
    /Invalid input/,
  );
  assert.throws(
    () =>
      bestEvaluationSchema.parse({
        results: [{ event: "event", output }],
      }),
    /Required/,
  );
  assert.throws(
    () =>
      bestEvaluationSchema.parse({
        results: [{ event: "event", output, notes: [""] }],
      }),
    /at least 1 character/,
  );
});

test("selects all required few-shot examples and rejects missing events", () => {
  const bestEvaluation = bestEvaluationSchema.parse({
    results: FEW_SHOT_EVENTS.map((event) => ({
      event,
      output,
      notes: ["note"],
    })),
  });

  assert.deepEqual(
    selectFewShotExamples(bestEvaluation).map((result) => result.event),
    [...FEW_SHOT_EVENTS],
  );
  assert.throws(
    () =>
      selectFewShotExamples({
        ...bestEvaluation,
        results: bestEvaluation.results.slice(1),
      }),
    /Required few-shot event is missing/,
  );
});

test("keeps Interaction Policy outside the Character Package", () => {
  const interactionPolicy = interactionPolicySchema.parse({
    principles: ["共通方針"],
  });
  const characterPrinciples = characterPrinciplesSchema.parse({
    principles: ["固有原則"],
  });
  const bestEvaluation = bestEvaluationSchema.parse({
    results: FEW_SHOT_EVENTS.map((event) => ({
      event,
      output,
      notes: ["note"],
    })),
  });

  const resources = createCognitionResources(
    interactionPolicy,
    spec,
    characterPrinciples,
    bestEvaluation,
  );

  assert.deepEqual(resources.interactionPolicy, interactionPolicy);
  assert.deepEqual(resources.characterPackage, {
    spec,
    principles: characterPrinciples,
    goldenEvaluation: bestEvaluation,
  });
  assert.equal("interactionPolicy" in resources.characterPackage, false);
});

test("loads the current Character Package and root Interaction Policy", async () => {
  const resources = await loadCognitionResources({ characterId: "hiro" });

  assert.equal(resources.characterPackage.spec.identity.name, "篠澤広");
  assert.ok(resources.characterPackage.principles.principles.length > 0);
  assert.ok(resources.characterPackage.goldenEvaluation.results.length > 0);
  assert.ok(resources.interactionPolicy.principles.length > 0);
  assert.equal("interactionPolicy" in resources.characterPackage, false);
  assert.deepEqual(
    resources.fewShotExamples.map((example) => example.event),
    [...FEW_SHOT_EVENTS],
  );
});

test("reports the Character ID and path when a package file is missing", async () => {
  await assert.rejects(
    loadCognitionResources({ characterId: "missing-character" }),
    /Character package "missing-character" was not found: characters\/missing-character/,
  );
});

test("reports a required file missing from an existing package", async () => {
  const characterId = `missing_file_${process.pid}`;
  const directory = new URL(`../characters/${characterId}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  try {
    await assert.rejects(
      loadCognitionResources({ characterId }),
      new RegExp(
        `Character package "${characterId}" is missing required file: characters/${characterId}/`,
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("attaches Golden comparison information", () => {
  const golden = { event: "event", output, notes: ["note"] };
  assert.deepEqual(createGoldenReference(output, golden), {
    golden_output: output,
    golden_notes: ["note"],
    comparison: {
      action_type_match: true,
      speech_exact_match: true,
      micro_reaction_exact_match: true,
    },
  });
  assert.deepEqual(createGoldenReference(waitOutput, golden).comparison, {
    action_type_match: false,
    speech_exact_match: false,
    micro_reaction_exact_match: false,
  });
  assert.deepEqual(createGoldenReference(output, undefined), {
    golden_output: null,
    golden_notes: null,
    comparison: null,
  });
});

test("includes Character ID in evaluation reports", () => {
  const evaluatedAt = new Date("2026-01-02T03:04:05.000Z");
  assert.deepEqual(
    createEvaluationReport({
      evaluatedAt,
      model: "model",
      characterId: "hiro",
      results: [{ event: "event" }],
    }),
    {
      evaluated_at: "2026-01-02T03:04:05.000Z",
      model: "model",
      character_id: "hiro",
      results: [{ event: "event" }],
    },
  );
});

test("adds Cognition diagnostics to evaluation event results", () => {
  assert.deepEqual(createCognitionEvaluationFields(cognitionOutput), {
    cognition: {
      perception: cognitionOutput.perception,
      response_plan: cognitionOutput.response_plan,
    },
    output,
  });
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
  assert.deepEqual(runtime.getMemory()[0]?.output, output);
  assert.equal("perception" in runtime.getMemory()[0]!, false);
  assert.equal("response_plan" in runtime.getMemory()[0]!, false);

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
  assert.deepEqual(
    parseGeminiCognitionOutput(JSON.stringify(cognitionOutput)),
    cognitionOutput,
  );
  assert.deepEqual(
    parseGeminiCognitionOutput(JSON.stringify(waitCognitionOutput)),
    waitCognitionOutput,
  );
  assert.deepEqual(
    parseGeminiCognitionOutput(JSON.stringify(reactionCognitionOutput)),
    reactionCognitionOutput,
  );
});

test("rejects the old interpretation field and a missing event_summary", () => {
  const { event_summary, ...withoutSummary } = output;

  assert.throws(
    () =>
      parseGeminiCognitionOutput(
        JSON.stringify({
          ...cognitionOutput,
          runtime_output: { ...withoutSummary, interpretation: event_summary },
        }),
      ),
    /Gemini response does not match CognitionOutput/,
  );
  assert.throws(
    () =>
      parseGeminiCognitionOutput(
        JSON.stringify({ ...cognitionOutput, runtime_output: withoutSummary }),
      ),
    /Gemini response does not match CognitionOutput/,
  );
});

test("validates Cognition Output limits and response plan consistency", () => {
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        perception: { known_facts: [], unknowns: [] },
      }),
    /at least 1 element/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        perception: { known_facts: ["1", "2", "3", "4"], unknowns: [] },
      }),
    /at most 3 element/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        perception: {
          known_facts: ["fact"],
          unknowns: ["1", "2", "3", "4", "5"],
        },
      }),
    /at most 4 element/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        response_plan: {
          ...cognitionOutput.response_plan,
          response_length: "long",
        },
      }),
    /Invalid enum value/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        response_plan: {
          ...cognitionOutput.response_plan,
          relevant_character_traits: ["1", "2", "3", "4"],
        },
      }),
    /at most 3 element/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        response_plan: {
          ...cognitionOutput.response_plan,
          response_length: "none",
        },
      }),
    /response_length.*none|speech must be null/,
  );
  assert.throws(
    () =>
      cognitionOutputSchema.parse({
        ...cognitionOutput,
        runtime_output: { ...output, speech: null },
      }),
    /Invalid input/,
  );
});

test("rejects malformed or invalid action combinations", () => {
  assert.throws(
    () => parseGeminiCognitionOutput(""),
    /Gemini returned an empty response/,
  );
  assert.throws(
    () => parseGeminiCognitionOutput("not json"),
    /Gemini returned invalid JSON/,
  );
  assert.throws(
    () => parseGeminiCognitionOutput('{"event_summary":"missing fields"}'),
    /Gemini response does not match CognitionOutput/,
  );
  assert.throws(
    () =>
      parseGeminiCognitionOutput(
        JSON.stringify({
          ...cognitionOutput,
          runtime_output: { ...output, speech: null },
        }),
      ),
    /Gemini response does not match CognitionOutput/,
  );
  assert.throws(
    () =>
      parseGeminiCognitionOutput(
        JSON.stringify({
          ...waitCognitionOutput,
          runtime_output: { ...waitOutput, speech: "話しかける" },
        }),
      ),
    /Gemini response does not match CognitionOutput/,
  );
  assert.throws(
    () =>
      parseGeminiCognitionOutput(
        JSON.stringify({
          ...reactionCognitionOutput,
          runtime_output: { ...reactionOutput, micro_reaction: null },
        }),
      ),
    /Gemini response does not match CognitionOutput/,
  );
  assert.throws(
    () =>
      parseGeminiCognitionOutput(
        JSON.stringify({
          ...reactionCognitionOutput,
          runtime_output: { ...reactionOutput, speech: "話しかける" },
        }),
      ),
    /Gemini response does not match CognitionOutput/,
  );
});

test("does not update state or memory when cognition returns invalid output", async () => {
  const runtime = new CharacterRuntime(spec, new InvalidOutputEngine());

  await assert.rejects(
    runtime.processEvent("event"),
    /Gemini response does not match CognitionOutput/,
  );
  assert.deepEqual(runtime.getState(), { energy: 5, affinity: 0, mood: "calm" });
  assert.deepEqual(runtime.getMemory(), []);
});
