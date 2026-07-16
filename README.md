# Character Runtime v0.1

Character Spec、現在のState、直近のMemory、現在のEventをLLMへ渡し、構造化されたAction Intentを得る最小CLIプロトタイプです。

## Setup

Node.js 20以降が必要です。

```powershell
npm install
$env:OPENAI_API_KEY = "your_api_key"
npm start
```

モデルは既定で `gpt-5-mini` です。変更する場合だけ `OPENAI_MODEL` を指定します。

```powershell
$env:OPENAI_MODEL = "gpt-5-mini"
```

CLIではEvent本文を入力します。終了するには `exit` を入力します。

```text
Character Runtime v0.1 (type 'exit' to quit)
> event: user returned home
```

StateとMemoryはプロセス内だけに保持され、CLI終了時に破棄されます。

## Verification

```powershell
npm run typecheck
npm test
```
