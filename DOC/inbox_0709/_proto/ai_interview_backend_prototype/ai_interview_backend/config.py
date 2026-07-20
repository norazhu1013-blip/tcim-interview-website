# -*- coding: utf-8 -*-
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Settings:
    # 模型配置：兼容OpenAI协议的厂商均可，只需改base_url、api_key、model。
    model_base_url: str = os.getenv("MODEL_BASE_URL", "https://api.deepseek.com/v1")
    model_api_key: str = os.getenv("MODEL_API_KEY", "")
    model_name: str = os.getenv("MODEL_NAME", "deepseek-v4-flash")
    model_temperature: float = float(os.getenv("MODEL_TEMPERATURE", "0.3"))
    model_timeout_sec: int = int(os.getenv("MODEL_TIMEOUT_SEC", "60"))
    mock_model: bool = os.getenv("MOCK_MODEL", "true").lower() in {"1", "true", "yes", "y"}

    # 路径配置。
    knowledge_dir: Path = Path(os.getenv("KNOWLEDGE_DIR", "./knowledge_base"))
    materials_dir: Path = Path(os.getenv("MATERIALS_DIR", "./outputs"))
    session_dir: Path = Path(os.getenv("SESSION_DIR", "./outputs/sessions"))

    # 访谈控制。
    max_item_minutes: int = int(os.getenv("MAX_ITEM_MINUTES", "10"))
    min_item_minutes: int = int(os.getenv("MIN_ITEM_MINUTES", "8"))
    max_turns_per_item: int = int(os.getenv("MAX_TURNS_PER_ITEM", "10"))
    evidence_model_json: bool = os.getenv("EVIDENCE_MODEL_JSON", "true").lower() in {"1", "true", "yes", "y"}


settings = Settings()
