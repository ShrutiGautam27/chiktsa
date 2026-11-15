"""LLM client layer.

* GeminiClient — Google Gemini via the REST API with structured JSON output (`responseSchema`).
  The API key lives only on the server (GEMINI_API_KEY). Requests carry the minimal, authorised
  context for ONE senior in ONE household; nothing is logged.
* `get_llm()` returns None when Gemini is not configured — callers then use their deterministic
  offline implementation and label results `engine: "offline"`.

Responses are validated against Pydantic schemas; invalid output raises AIUnavailable and the
caller falls back to the offline result rather than showing unvalidated text.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from ..config import get_settings

log = logging.getLogger("carehub.ai")
T = TypeVar("T", bound=BaseModel)


class AIUnavailable(Exception):
    pass


def _schema(model: type[BaseModel]) -> dict:
    """Convert a Pydantic JSON schema into Gemini's OpenAPI-subset responseSchema (inline refs, drop titles)."""
    raw = model.model_json_schema()
    defs = raw.pop("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                return walk(defs[node["$ref"].split("/")[-1]])
            if "anyOf" in node:  # Optional[X] → X with nullable
                options = [o for o in node["anyOf"] if o.get("type") != "null"]
                out = walk(options[0]) if options else {"type": "string"}
                out["nullable"] = True
                return out
            return {k: walk(v) for k, v in node.items() if k not in ("title", "default", "additionalProperties")}
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node

    return walk(raw)


class GeminiClient:
    name = "gemini"

    def __init__(self, api_key: str, model: str, timeout: float = 30.0):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def generate(self, system: str, prompt: str, schema: type[T], files: list[tuple[str, bytes]] | None = None,
                 temperature: float = 0.1) -> T:
        parts: list[dict] = [{"text": prompt}]
        for mime, data in files or []:
            parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}})
        body = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": temperature, "responseMimeType": "application/json",
                                 "responseSchema": _schema(schema)},
        }
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        try:
            r = httpx.post(url, json=body, headers={"x-goog-api-key": self.api_key}, timeout=self.timeout)
        except httpx.HTTPError as e:
            raise AIUnavailable(f"network: {type(e).__name__}") from e
        if r.status_code != 200:
            log.warning('"gemini http %s"', r.status_code)
            raise AIUnavailable(f"HTTP {r.status_code}")
        try:
            data = r.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            return schema.model_validate(json.loads(text))
        except (KeyError, IndexError, json.JSONDecodeError, ValidationError) as e:
            raise AIUnavailable("invalid model output") from e


_override: Any = None


def set_llm(client: Any) -> None:
    """Tests inject a fake client here."""
    global _override
    _override = client


def get_llm():
    if _override is not None:
        return _override
    s = get_settings()
    if s.gemini_api_key:
        return GeminiClient(s.gemini_api_key, s.gemini_model)
    return None
