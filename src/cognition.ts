import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import {
  createCharacterReferenceCandidates,
  validateCharacterReferences,
  type CognitionOutputWithReferenceWarnings,
} from "./character-references.js";
import {
  type BestEvaluationResult,
  type CharacterPrinciples,
  type CharacterSpec,
  type CognitionOutput,
  type InteractionPolicy,
  type RuntimeOutput,
  type ReactionPresets,
} from "./schema.js";
import {
  cognitionDraftSchema,
  resolveCognitionDraft,
} from "./reaction-presets.js";
import type { MemoryEntry } from "./memory.js";
import type { EventTimeContext, RuntimeEvent } from "./event.js";
import type { CharacterState } from "./state.js";

export type CognitionInput = {
  characterSpec: CharacterSpec;
  currentState: CharacterState;
  recentMemory: readonly MemoryEntry[];
  currentEvent: RuntimeEvent;
  eventTime: EventTimeContext;
};

export interface CognitionEngine {
  process(input: CognitionInput): Promise<RuntimeOutput>;
}

const SYSTEM_PROMPT = `# Runtime共通規則
あなたは、一人の架空キャラクターのCognition Engineです。
キャラクターはユーザーのデスクトップ上に存在するソフトウェア上の存在で、現実世界へ直接干渉できる身体を持ちません。荷物を持つ、飲み物を作る、ユーザーへ触れる、隣に立つなど、実行不能な物理行動を提案・描写しないでください。
action_intentは、発話、待機、質問、通知、画面上の反応など、現在または将来ソフトウェアとして実行可能な行動に限定します。
micro_reactionでは、将来のデスクトップアバターで表現できる表情、視線、姿勢を記述できますが、現実世界への物理的干渉を描写してはいけません。

Eventは、Character Spec、現在のState、Recent Memoryに基づいて厳密に解釈してください。人格、関係性、発話スタイル、State変化、アバター反応、Action選択傾向はCharacter Specを基準にします。
ユーザーの呼称には、既定値の解決済みであるcharacter_spec.identity.user_addressを使います。
Character Specは選択や表現へ反映し、設定内容を発話で引用・列挙・説明しないでください。event_summaryは人格表現を混ぜず、Eventの事実だけを扱います。

Cognition OutputのJSONオブジェクトを一つだけ返してください。MarkdownやJSON以外の文章は出力しません。詳細な思考過程や長い推論は出力せず、各フィールドには短い判断結果だけを入れてください。
JSONキーは現在の英語名を維持します。perception、character_references、response_plan、event_summary、speech、micro_reactionを含む自然言語値は日本語にし、英語の説明や補足を混在させないでください。

event_summaryには、何が起きたか、ユーザーが何を言ったかなど、Eventから直接確認できる事実だけを日本語一文で簡潔に記述します。行動方針、Action選択理由、助言、システム能力、非物理的制約、キャラクターの感想、入力にないユーザーの感情や状況は含めません。
state_effectには、-2から2までの整数でenergyとaffinityの変化量を入れ、Event後のmoodを選びます。
action_intent.typeはrespond、wait、show_reactionのいずれかです。
- respond: 発話が必要な場合だけ選び、speechを生成します。micro_reactionは日本語文字列または、反応を変えない場合はnullです。
- wait: 発話せず静かに待つ場合に選び、speechをnullにします。micro_reactionは日本語文字列またはnullです。
- show_reaction: 発話せず画面上の反応だけを示す場合に選び、speechをnull、micro_reactionを日本語文字列にします。

response_plan.response_modeでは、最終反応の作り方を選びます。
- silent: 発話しない場合に選びます。preset_idはnullです。runtime_outputはwaitまたはshow_reactionの完全な出力を生成します。
- preset: reaction_presetsに現在のEventへ直接適用できる登録済み反応がある場合に選びます。preset_idへ登録済みIDを完全一致で設定します。Runtimeが登録値を解決するため、runtime_outputにはevent_summaryとstate_effectだけを出力し、action_intent、speech、micro_reactionは出力しないでください。Presetのspeechを作り直したり言い換えたりしてはいけません。response_lengthはPresetのaction_typeに合わせてRuntimeが確定します。
- generated: Presetがない、または現在の文脈へPresetが適さず、従来どおり自由生成する場合に選びます。preset_idはnullで、runtime_outputを完全に生成します。
reaction_presetsが空の場合はpresetを選ばず、silentまたはgeneratedを選びます。挨拶、沈黙、時刻を特別に強調しない通常の帰宅では、直接適用できるPresetを優先してください。称賛、批判、試験失敗など、対応PresetがないEventはgeneratedのままにします。eveningやmorningの時刻差を反映する必要があり、通常帰宅Presetの内容が適さない場合もgeneratedを選びます。

入力に根拠のない事実を追加しないでください。known_factsにない内容をevent_summaryやspeechで事実として扱ってはいけません。特に、称賛の対象がアイドル活動である、プロデューサーが何かを期待していた、落ち込んでいる、努力していた、将来も成功する、という内容を入力なしで補わないでください。帰宅理由や外出時間も推測しません。

現在のEventは構造化データです。type、source、payload、name、dataなどの内部フィールド名をspeechで読み上げないでください。
user.messageのpayload.textはユーザーが実際に発言した内容です。system.observationはシステムが観測した確定情報であり、ユーザーの発言ではありません。両者を混同しないでください。
occurred_at、time_of_day、utc_offsetは、時刻文脈によって反応が変わる場合だけ使い、時刻を不自然に毎回発話へ含めないでください。
帰宅Eventではtime_of_dayを反応姿勢へ反映します。eveningでは一日の終わりを意識した短い労いを許容します。morningでは夕方と同じ定型的な労いを機械的に使いません。早朝帰宅を朝帰り、徹夜、長時間の外出、疲労と解釈せず、時刻をそのまま読み上げないでください。

# 入力コンテキスト
入力はruntime_rules、interaction_policy、character_spec、character_principles、examples、current_contextに分かれています。
Interaction Policyは、デスクトップ常駐時のキャラクター非依存の方針です。キャラクター自身の価値観、台詞の方針、システム設定として発話しないでください。
Character Specは安定した人格と口調、Character Principlesはこのキャラクター固有の具体的な判断を定義します。Examplesはそれらの解釈例であり、固定応答表ではありません。Event文字列が一致しても例文をそのままコピーせず、判断傾向、関係性、発話傾向を現在のEventへ一般化してください。
指示が競合する場合は、RuntimeOutputの構造・安全制約・現在のEventから確定している事実、Interaction Policy、Character Principles、Examplesが示す具体的傾向、Character Specの抽象的傾向の順で優先します。
現在のStateとMemoryは文脈として使いますが、現在のEventから確定している事実を上書きしてはいけません。`;

const COGNITION_PROCEDURE = `# 出力手順
1. Eventから確定している事実だけをperception.known_factsへ整理します。評価や推測を加えず、1件から3件の短い言い換えにします。
2. 最終的なstanceまたはaction_intentを変える可能性がある不明情報だけをperception.unknownsへ整理します。単に不明、興味がある、会話を続けるために知りたいだけの情報は含めません。該当しなければ空配列とし、最大4件です。unknownsの内容をevent_summary、speech、micro_reactionで事実として断定しません。
3. character_reference_candidatesから、現在のEventに直接関係するCharacter SpecとCharacter Principlesだけを選びます。文字列は言い換え、短縮、翻訳、一般化をせず完全一致で引用し、spec_itemsとprinciplesをそれぞれ最大2件にします。
4. 短いstance、助言の要否、質問の要否、発話量とresponse_modeを決めます。Presetを選ぶ場合は、reaction_presetsから直接適用できるpreset_idを一つ選びます。
5. response_planに従ってruntime_outputを生成します。
6. 中間判断とruntime_outputに矛盾がないか確認します。should_ask_questionがfalseならspeech内の質問を削除し、should_adviseがfalseならユーザーへの指示・助言・気持ちを変えるよう求める表現を削除します。response_lengthがshortなら、Eventから確定している事実またはキャラクターの直接的な反応ではない文や節を削除してください。

response_plan.stanceは短い句または一文とし、speechでstanceそのものを説明しません。
Character参照は、選ぶことでstance、action_intent、speech、micro_reactionが実際に変わり、選ばなければ一般的な反応になってしまう項目だけにします。一般的な特徴、プロデューサーへの言及、感情的な近さ、Eventとの単語の類似、多少関係する背景という理由だけでは選びません。
現在のEventへ直接適用できるCharacter Principleを優先し、それだけでは反応姿勢や表現を決められない場合にCharacter Specを補助的に選びます。該当項目がなければ両配列を空にします。呼称、一人称、一般的な口調を毎Eventで選ぶ必要はありません。
Interaction Policy、Runtime共通規則、物理的制約、ソフトウェアとしての存在形式、モデルの常識、独自の解釈はcharacter_referencesへ含めません。これらの規則はCharacter参照へ入れなくてもresponse_planとruntime_outputで守ります。
stanceには参照元や制約の説明を書かず、キャラクターがどのように反応するかだけを記述します。キャラクターの背景や経験をユーザーへ投影しません。

should_adviseは、明確な相談、助言依頼、説明依頼がある場合だけtrueを検討します。falseの場合は、手順、複数の対処法、求められていない一般論や助言をspeechへ追加しません。
should_ask_questionは、応答に実用上必要な質問がある場合だけtrueにします。会話を続けるためだけの質問は行いません。falseの場合、speechに質問を含めず、質問で終えません。批判、称賛、報告へ自動的に詳細質問を追加しないでください。

response_lengthは、発話しない場合にnone、Eventへの直接的な短い反応にshort、明確な相談や説明依頼へ必要な説明をする場合だけmediumを使います。
shortではEventへの直接的な反応だけを、原則一文、必要な場合だけ短い二文で返します。入力に根拠がないユーザーの期待、将来の成功予測、感情、努力量、Eventの背景や理由、会話継続だけを目的とする質問、一般的な励ましや助言、キャラクター設定の説明を追加しません。
称賛だけから、ユーザーが以前から見守っていた、キャラクターが期待へ応えた、キャラクターが成長したとは判断しません。試験失敗の報告だけから、ユーザーが落ち込んでいる前提の慰めや励ましを加えず、「気にしないで」など気持ちへの指示もしません。課題が簡単だったという報告へ、キャラクター自身の退屈な経験を投影したり、感想を尋ねる質問を加えたりしません。「あなたなら当然」「そうだと思っていた」など、入力にない事前期待も述べません。
Characterらしさは説明を増やすのではなく、語調、言葉選び、micro_reactionへ反映します。
response_lengthがnoneならspeechはnullです。respondではshortまたはmediumを選び、speechを生成します。waitとshow_reactionではnoneを選び、speechをnullにします。

ExamplesにはEvent、Golden RuntimeOutput、notesだけが含まれます。Examplesは最終的な判断傾向と表現例として扱い、存在しない中間判断のGoldenデータを補わないでください。`;

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

const runtimeOutputDraftJsonSchema = {
  anyOf: [
    ...runtimeOutputJsonSchema.anyOf,
    {
      type: "object",
      additionalProperties: false,
      properties: {
        ...runtimeOutputBaseJsonProperties,
      },
      required: ["event_summary", "state_effect"],
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
    character_references: {
      type: "object",
      additionalProperties: false,
      properties: {
        spec_items: {
          type: "array",
          maxItems: 2,
          uniqueItems: true,
          items: { type: "string" },
        },
        principles: {
          type: "array",
          maxItems: 2,
          uniqueItems: true,
          items: { type: "string" },
        },
      },
      required: ["spec_items", "principles"],
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
        response_mode: {
          type: "string",
          enum: ["silent", "preset", "generated"],
        },
        preset_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: [
        "stance",
        "should_advise",
        "should_ask_question",
        "response_length",
        "response_mode",
        "preset_id",
      ],
    },
    runtime_output: runtimeOutputDraftJsonSchema,
  },
  required: [
    "perception",
    "character_references",
    "response_plan",
    "runtime_output",
  ],
} as const;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function parseGeminiCognitionOutput(
  text: string | undefined,
  options: {
    characterId: string;
    characterSpec: CharacterSpec;
    characterPrinciples: CharacterPrinciples;
    reactionPresets: ReactionPresets;
  },
): CognitionOutputWithReferenceWarnings {
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

  let draft;
  try {
    draft = cognitionDraftSchema.parse(parsed);
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

  const output = resolveCognitionDraft(draft, options.reactionPresets);
  return validateCharacterReferences(output, options);
}

export class GeminiCognitionEngine implements CognitionEngine {
  readonly #client: GoogleGenAI;
  readonly #model: string;
  readonly #characterId: string;
  readonly #interactionPolicy: InteractionPolicy;
  readonly #characterPrinciples: CharacterPrinciples;
  readonly #fewShotExamples: readonly BestEvaluationResult[];
  readonly #reactionPresets: ReactionPresets;
  #lastCognitionOutput: CognitionOutputWithReferenceWarnings | undefined;

  constructor(options: {
    apiKey: string;
    characterId: string;
    model?: string;
    interactionPolicy: InteractionPolicy;
    characterPrinciples: CharacterPrinciples;
    fewShotExamples: readonly BestEvaluationResult[];
    reactionPresets?: ReactionPresets;
  }) {
    this.#client = new GoogleGenAI({ apiKey: options.apiKey });
    this.#characterId = options.characterId;
    this.#model = options.model ?? "gemini-3.1-flash-lite";
    this.#interactionPolicy = options.interactionPolicy;
    this.#characterPrinciples = options.characterPrinciples;
    this.#fewShotExamples = options.fewShotExamples;
    this.#reactionPresets = options.reactionPresets ?? { presets: [] };
  }

  getLastCognitionOutput(): CognitionOutputWithReferenceWarnings | undefined {
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
            character_reference_candidates: createCharacterReferenceCandidates(
              input.characterSpec,
              this.#characterPrinciples,
            ),
            reaction_presets: this.#reactionPresets.presets.map((preset) => ({
              id: preset.id,
              description: preset.description,
              action_type: preset.action_intent.type,
              response_length:
                preset.action_intent.type === "respond" ? "short" : "none",
            })),
            examples: this.#fewShotExamples,
            current_context: {
              current_state: input.currentState,
              recent_memory: input.recentMemory,
              current_event: input.currentEvent,
              occurred_at: input.eventTime.occurred_at,
              time_of_day: input.eventTime.time_of_day,
              utc_offset: input.eventTime.utc_offset,
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

    const cognitionOutput = parseGeminiCognitionOutput(responseText, {
      characterId: this.#characterId,
      characterSpec: input.characterSpec,
      characterPrinciples: this.#characterPrinciples,
      reactionPresets: this.#reactionPresets,
    });
    this.#lastCognitionOutput = cognitionOutput;
    return cognitionOutput.runtime_output;
  }
}
