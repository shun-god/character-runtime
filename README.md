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

## Evaluation

固定Eventセットを順番に評価し、結果を `evaluation/results/` に保存します。

```powershell
npm run evaluate
```

## Verification

```powershell
npm run typecheck
npm test
```
