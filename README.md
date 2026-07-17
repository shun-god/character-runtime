# Character Runtime v0.1

Character Spec、現在のState、直近のMemory、現在のEventをLLMへ渡し、構造化されたAction Intentを得る最小CLIプロトタイプです。

## Setup

Node.js 24以降が必要です。

```powershell
npm install
Copy-Item .env.example .env
npm start
```

作成した `.env` に `GEMINI_API_KEY` を設定してください。`.env` はGit管理から除外されています。
モデルは既定で `gemini-3.1-flash-lite` です。変更する場合だけ `GEMINI_MODEL` を指定します。

PowerShellで一時的に環境変数を設定する従来の方法も利用できます。

```powershell
$env:GEMINI_API_KEY = "your_api_key"
$env:GEMINI_MODEL = "gemini-3.1-flash-lite"
npm start
```

CLIではEvent本文を入力します。終了するには `exit` を入力します。

```text
Character Runtime v0.1 (type 'exit' to quit)
> event: user returned home
```

StateとMemoryはプロセス内だけに保持され、CLI終了時に破棄されます。

## Cognition Sources

- `interaction-policy.json`: デスクトップ常駐時の共通Interaction Policy
- `characters/hiro/character-spec.json`: 安定した人格、関係性、口調、行動傾向
- `characters/hiro/character-principles.json`: 現在のキャラクター固有の応答判断
- `characters/hiro/best-evaluation.json`: 現在のキャラクター固有の理想出力と評価基準。固定応答テーブルではありません

`characters/hiro/`が現在の既定Character Packageです。Character Spec、Character Principles、Best Evaluationで構成され、`interaction-policy.json`はPackage外のRuntime共通設定です。現在も代表5例だけをFew-shotとして使用し、LLM呼び出しは一回のままです。

Character IDの既定値は`hiro`です。`characters/<id>/`からPackageを読み込み、CLI引数、環境変数、既定値の順で決定します。

```powershell
npm run dev -- --character hiro
npm run evaluate -- --character hiro
$env:CHARACTER_ID = "hiro"
npm run dev
```

現時点ではCharacter一覧、自動探索、GUIによる切り替えは未実装です。`interaction-policy.json`は全Character共通です。

## Cognition Output

Cognitionは一回のLLM呼び出しで、中間判断とRuntimeOutputをまとめて生成します。`perception`はEventから確認できる事実と重要な不明情報、`response_plan`は反応姿勢、助言・質問の要否、発話量を保持します。

`character_references`はCharacter SpecとCharacter Principlesへ分け、入力された設定文を完全一致で引用します。Character SpecへIDを付ける必要はなく、存在しない引用はCognition Output検証で拒否します。Interaction PolicyはCharacter参照へ含めません。

Runtimeが実行するのは`runtime_output`だけです。Character参照を含む中間判断は診断・評価用であり、RuntimeやMemoryへ渡しません。LLM呼び出しは一回のままで、複数LLMレイヤーはまだ実装していません。

## Evaluation

固定Eventセットを順番に評価し、結果とGolden Evaluationの完全一致比較を `evaluation/results/` に保存します。GoldenがないEventでは、Golden関連フィールドは`null`になります。

```powershell
npm run evaluate
```

## Verification

```powershell
npm run typecheck
npm test
```
