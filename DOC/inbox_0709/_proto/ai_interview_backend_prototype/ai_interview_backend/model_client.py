# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from typing import Any, Dict, List

import httpx

from .config import settings


class ModelClient:
    def __init__(self) -> None:
        self.base_url = settings.model_base_url.rstrip("/")
        self.api_key = settings.model_api_key
        self.model_name = settings.model_name
        self.mock = settings.mock_model or not bool(self.api_key)

    async def chat(self, messages: List[Dict[str, str]], json_mode: bool = False) -> str:
        if self.mock:
            return self._mock_response(messages, json_mode=json_mode)
        payload: Dict[str, Any] = {
            "model": self.model_name,
            "messages": messages,
            "temperature": settings.model_temperature,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=settings.model_timeout_sec) as client:
            resp = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    def _mock_response(self, messages: List[Dict[str, str]], json_mode: bool = False) -> str:
        if json_mode:
            return json.dumps({
                "child_perspective_evidence": "模拟结果：教师能够或部分能够解释儿童行为背后的游戏意义，需用真实模型进一步判断。",
                "intervention_timing": "模拟结果：需关注教师是否先观察和澄清，再介入。",
                "value_balance": "模拟结果：需关注教师如何平衡儿童自主、规则安全与教育目标。",
                "strategy_generation": "模拟结果：需检查教师是否给出具体现场语言和行动步骤。",
                "key_quotes": [],
                "unresolved_questions": "模拟模式下未进行真实语义判断。",
                "ability_inference": "仅为程序联调占位，不作为真实能力判断。",
                "support_suggestion": "建议接入真实模型后生成个别化支持建议。",
                "confidence": "low",
            }, ensure_ascii=False)
        # 根据最后用户消息粗略生成下一问。
        user_text = messages[-1]["content"] if messages else ""
        if "开场定位" in user_text or "opening" in user_text:
            return "我们先回到这个情境本身。您当时最先注意到孩子表现中的什么？"
        if "情境理解" in user_text:
            return "您觉得孩子这样的表现背后，可能反映了什么兴趣、需要或游戏想法？"
        if "选项比较" in user_text:
            return "这几种做法里，您当时最难比较的是哪两个？您主要是怎样权衡它们的？"
        if "专业假设验证" in user_text:
            return "如果现场情况比题目里更复杂一些，您会如何判断什么时候先观察、什么时候需要介入？"
        if "现场策略生成" in user_text:
            return "如果您就在现场，您会对孩子说的第一句话是什么？后面会怎么接？"
        return "我理解您的意思了。您能再具体说说，您在现场会怎样做吗？"
