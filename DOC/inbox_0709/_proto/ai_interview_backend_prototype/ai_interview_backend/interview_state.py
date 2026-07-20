# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import settings
from .knowledge_loader import KnowledgeLoader
from .model_client import ModelClient
from .prompt_builder import STAGE_SEQUENCE, build_evidence_messages, build_interview_messages, build_opening_question
from .utils import ensure_dir, safe_json_loads


@dataclass
class InterviewSession:
    session_id: str
    userOpenid: str
    final_rank: int
    questionIndex: int
    item_title: str
    task_card: Dict[str, Any]
    knowledge_snippets: str
    stage_index: int = 0
    turn_count: int = 0
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    dialogue: List[Dict[str, str]] = field(default_factory=list)
    evidence: Optional[Dict[str, Any]] = None

    @property
    def stage(self) -> str:
        return STAGE_SEQUENCE[min(self.stage_index, len(STAGE_SEQUENCE) - 1)]

    def should_finish(self) -> bool:
        return self.turn_count >= settings.max_turns_per_item or self.stage_index >= len(STAGE_SEQUENCE) - 1


class SessionStore:
    def __init__(self, session_dir: str | Path | None = None) -> None:
        self.session_dir = ensure_dir(session_dir or settings.session_dir)
        self.sessions: Dict[str, InterviewSession] = {}

    def save(self, session: InterviewSession) -> None:
        self.sessions[session.session_id] = session
        path = self.session_dir / f"{session.session_id}.json"
        path.write_text(json.dumps(asdict(session), ensure_ascii=False, indent=2), encoding="utf-8")

    def get(self, session_id: str) -> InterviewSession:
        if session_id in self.sessions:
            return self.sessions[session_id]
        path = self.session_dir / f"{session_id}.json"
        if not path.exists():
            raise KeyError(f"访谈会话不存在：{session_id}")
        data = json.loads(path.read_text(encoding="utf-8"))
        session = InterviewSession(**data)
        self.sessions[session_id] = session
        return session


class InterviewService:
    def __init__(self, knowledge_dir: str | Path) -> None:
        self.knowledge_loader = KnowledgeLoader(knowledge_dir)
        self.knowledge_loader.load_all()
        self.model = ModelClient()
        self.store = SessionStore()

    async def start(self, task_card_json: str) -> InterviewSession:
        task_card = safe_json_loads(task_card_json, {})
        if not task_card:
            raise ValueError("task_card_json不是合法JSON")
        q = int(task_card.get("questionIndex"))
        item_knowledge = self.knowledge_loader.get(q)
        snippets = item_knowledge.relevant_snippets(task_card)
        session = InterviewSession(
            session_id=str(uuid.uuid4()),
            userOpenid=task_card.get("userOpenid", ""),
            final_rank=int(task_card.get("final_rank", 1)),
            questionIndex=q,
            item_title=task_card.get("item_title", ""),
            task_card=task_card,
            knowledge_snippets=snippets,
        )
        opening = build_opening_question(task_card)
        session.dialogue.append({"role": "assistant", "content": opening})
        self.store.save(session)
        return session

    async def next_question(self, session_id: str, teacher_message: str) -> InterviewSession:
        session = self.store.get(session_id)
        session.dialogue.append({"role": "teacher", "content": teacher_message})
        if session.stage_index < len(STAGE_SEQUENCE) - 1:
            session.stage_index += 1
        session.turn_count += 1
        messages = build_interview_messages(session.task_card, session.knowledge_snippets, session.dialogue, session.stage)
        assistant_message = await self.model.chat(messages)
        session.dialogue.append({"role": "assistant", "content": assistant_message})
        self.store.save(session)
        return session

    async def finish_item(self, session_id: str) -> InterviewSession:
        session = self.store.get(session_id)
        messages = build_evidence_messages(session.task_card, session.knowledge_snippets, session.dialogue)
        content = await self.model.chat(messages, json_mode=True)
        evidence = safe_json_loads(content, None)
        if evidence is None:
            evidence = {"raw_model_output": content, "confidence": "low", "parse_error": "模型未返回合法JSON"}
        session.evidence = evidence
        self.store.save(session)
        return session
