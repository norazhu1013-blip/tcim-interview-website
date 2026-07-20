# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class PrepareMaterialsRequest(BaseModel):
    results_csv_path: str = Field(..., description="测验结果CSV路径")
    logs_csv_path: Optional[str] = Field(None, description="过程日志CSV路径；没有可为空")
    output_dir: str = Field("./outputs/advisor_run", description="输出目录")
    knowledge_dir: str = Field("./knowledge_base", description="10题知识库目录")


class TaskCardRow(BaseModel):
    participantName: str = ""
    userOpenid: str
    final_rank: int
    questionIndex: int
    item_title: str
    task_card_json: str


class StartInterviewRequest(BaseModel):
    userOpenid: str
    final_rank: int = 1
    task_card_json: Optional[str] = None


class StartInterviewResponse(BaseModel):
    session_id: str
    userOpenid: str
    final_rank: int
    questionIndex: int
    item_title: str
    assistant_message: str
    stage: str


class NextMessageRequest(BaseModel):
    session_id: str
    teacher_message: str


class NextMessageResponse(BaseModel):
    session_id: str
    assistant_message: str
    stage: str
    turn_count: int
    should_finish: bool = False


class FinishItemRequest(BaseModel):
    session_id: str


class EvidenceTable(BaseModel):
    session_id: str
    userOpenid: str
    questionIndex: int
    item_title: str
    evidence: Dict[str, Any]
    dialogue: List[Dict[str, str]]


class HealthResponse(BaseModel):
    status: str
    mock_model: bool
    model_name: str
