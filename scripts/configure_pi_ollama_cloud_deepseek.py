#!/usr/bin/env python3
import json
from pathlib import Path


AGENT_DIR = Path.home() / ".pi" / "agent"
MODELS_JSON = AGENT_DIR / "models.json"
PROVIDER_NAME = "deepseek-ollama-cloud"
PROVIDER = {
    "name": "DeepSeek via Ollama Cloud on Windows",
    "api": "openai-completions",
    "baseUrl": "http://127.0.0.1:11435/v1",
    "apiKey": "ollama",
    "models": [
        {
            "id": "deepseek-v3.1:671b-cloud",
            "name": "DeepSeek V3.1 671B Cloud",
            "reasoning": False,
            "input": ["text"],
            "cost": {
                "input": 0,
                "output": 0,
                "cacheRead": 0,
                "cacheWrite": 0,
            },
            "contextWindow": 131072,
            "maxTokens": 65536,
            "compat": {
                "supportsDeveloperRole": False,
                "supportsReasoningEffort": False,
            },
        }
    ],
}


def main() -> None:
    AGENT_DIR.mkdir(parents=True, exist_ok=True)
    if MODELS_JSON.exists():
        data = json.loads(MODELS_JSON.read_text())
    else:
        data = {"providers": {}}
    data.setdefault("providers", {})[PROVIDER_NAME] = PROVIDER
    MODELS_JSON.write_text(json.dumps(data, indent=2) + "\n")
    print(f"configured {PROVIDER_NAME} in {MODELS_JSON}")


if __name__ == "__main__":
    main()
