# -*- coding: utf-8 -*-
"""测验结果解析与赋分。

说明：SCORE_CSV来自旧程序，但旧程序题号与当前知识库题号不一致。
本模块通过 NEW_TO_OLD_QUESTION_INDEX 把赋分列重排到当前知识库顺序。
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .question_bank import NEW_TO_OLD_QUESTION_INDEX, get_question
from .utils import read_csv_dicts


SCORE_CSV_OLD_ORDER = """选项组合,01赋分,02赋分,03赋分,04赋分,05赋分,06赋分,07赋分,08赋分,09赋分,10赋分
ABCD,4,0,0,2,2,2,0,2,0,1
ABDC,3,2,0,2,2,4,3,2,1,2
ACBD,4,1,0,3,2,1,0,1,1,2
ACDB,2,1,0,4,1,1,1,1,1,2
ADBC,1,1,0,2,1,4,2,2,1,2
ADCB,1,2,1,3,0,3,1,1,3,3
BACD,2,1,0,2,3,2,2,2,0,1
BADC,1,4,0,1,3,2,2,3,2,1
BCAD,3,2,1,1,2,4,1,2,1,0
BCDA,1,3,3,1,1,4,0,2,1,1
BDAC,1,4,2,1,4,4,2,4,2,2
BDCA,0,4,3,0,3,2,1,3,0,1
CABD,4,1,1,2,1,3,0,1,2,1
CADB,2,1,1,3,0,1,1,0,4,2
CBAD,3,2,2,2,0,3,1,1,2,1
CBDA,1,1,4,1,1,1,0,2,2,1
CDAB,2,2,2,2,1,0,2,1,4,2
CDBA,1,4,3,2,1,0,2,1,1,2
DABC,1,1,3,2,2,3,1,2,2,3
DACB,0,1,2,2,2,3,2,2,3,4
DBAC,0,3,3,1,3,3,1,3,2,2
DBCA,0,3,4,1,1,3,2,2,1,2
DCAB,0,2,3,2,0,0,2,1,1,3
DCBA,0,3,4,1,2,2,4,2,1,2
"""


@dataclass
class ItemResult:
    participantName: str
    userOpenid: str
    questionIndex: int
    item_id: str
    item_title: str
    chosen_comb: str
    score: int
    mean_score: float = 0.0
    total_score: int = 0
    rd: float = 0.0
    abs_rd: float = 0.0


class ScoringEngine:
    def __init__(self) -> None:
        self.score_dict = self._build_score_dict()

    def _build_score_dict(self) -> Dict[Tuple[int, str], int]:
        score_dict: Dict[Tuple[int, str], int] = {}
        rows = list(csv.DictReader(SCORE_CSV_OLD_ORDER.strip().splitlines()))
        for row in rows:
            comb = row["选项组合"].strip().upper()
            for new_q in range(1, 11):
                old_q = NEW_TO_OLD_QUESTION_INDEX[new_q]
                score_dict[(new_q, comb)] = int(row[f"{old_q:02d}赋分"])
        return score_dict

    def score(self, question_index: int, comb: str) -> int:
        return int(self.score_dict.get((int(question_index), comb.upper()), 0))

    def parse_results_csv(self, path: str) -> List[ItemResult]:
        rows = read_csv_dicts(path)
        if not rows:
            return []
        required = {"participantName", "userOpenid", "answers"}
        missing = required - set(rows[0].keys())
        if missing:
            raise ValueError(f"结果CSV缺少必要列：{sorted(missing)}")

        idx_to_char = {0: "A", 1: "B", 2: "C", 3: "D"}
        parsed: List[ItemResult] = []
        for row_num, row in enumerate(rows, start=2):
            participant = row.get("participantName", "")
            user_openid = row.get("userOpenid", "")
            try:
                answers = json.loads(row.get("answers", ""))
            except json.JSONDecodeError as exc:
                raise ValueError(f"第{row_num}行 answers 不是合法JSON") from exc

            for q_idx_str, answer_indexes in answers.items():
                # 平台通常用0-9键；统一转为知识库顺序1-10。
                question_index = int(q_idx_str) + 1
                question = get_question(question_index)
                try:
                    comb = "".join(idx_to_char[int(x)] for x in answer_indexes)
                except Exception as exc:
                    raise ValueError(f"第{row_num}行第{question_index}题答案格式异常：{answer_indexes}") from exc
                parsed.append(
                    ItemResult(
                        participantName=participant,
                        userOpenid=user_openid,
                        questionIndex=question_index,
                        item_id=question.item_id,
                        item_title=question.title,
                        chosen_comb=comb,
                        score=self.score(question_index, comb),
                    )
                )
        self._add_user_context(parsed)
        return parsed

    def _add_user_context(self, items: List[ItemResult]) -> None:
        by_user: Dict[str, List[ItemResult]] = defaultdict(list)
        for item in items:
            by_user[item.userOpenid].append(item)
        for user_items in by_user.values():
            total = sum(x.score for x in user_items)
            mean = total / len(user_items) if user_items else 0.0
            for x in user_items:
                x.total_score = total
                x.mean_score = mean
                x.rd = x.score - mean
                x.abs_rd = abs(x.rd)


def classify_teacher(mean_score: float) -> str:
    if mean_score >= 3.0:
        return "总体偏高"
    if mean_score < 2.0:
        return "总体偏低"
    return "总体中等"
