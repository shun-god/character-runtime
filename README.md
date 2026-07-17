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

`characters/hiro/`が現在のCharacter Packageです。Character Spec、Character Principles、Best Evaluationで構成され、`interaction-policy.json`はPackage外のRuntime共通設定です。現時点では切り替え機能は未実装で`hiro`を固定利用しますが、将来的なPackage差し替えを想定しています。現在も代表5例だけをFew-shotとして使用し、LLM呼び出しは一回のままです。

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
