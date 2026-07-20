# -*- coding: utf-8 -*-
from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Tuple

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

from .knowledge_loader import KnowledgeLoader, rules_to_task_fields
from .process_features import ProcessFeature, build_process_features
from .question_bank import get_question
from .scoring import ItemResult, ScoringEngine, classify_teacher
from .utils import ensure_dir, json_dumps_cn


AI_SAFE_COLUMNS = [
    "participantName", "userOpenid", "final_rank", "final_item_id", "questionIndex", "item_title",
    "scenarioText", "optionA", "optionB", "optionC", "optionD", "priorityOption", "priorityPair",
    "priorityOptionText", "priorityPairText", "safeInterviewPrompt", "forbiddenDisclosureReminder",
]

AI_TASK_CARD_COLUMNS = [
    "participantName", "userOpenid", "final_rank", "final_item_id", "questionIndex", "item_title",
    "task_card_json", "task_card_version", "scenarioText", "optionA", "optionB", "optionC", "optionD",
    "teacherFinalOrder", "teacherInitialOrder", "orderChanged", "priorityOption", "priorityPair",
    "priorityOptionText", "priorityPairText", "primary_ability_type", "secondary_ability_type",
    "interview_main_focus", "interview_secondary_focus", "interview_hypotheses", "must_obtain_evidence",
    "recommended_interview_flow", "recommended_probes", "forbidden_disclosure",
]

FORBIDDEN_DISCLOSURE = [
    "不得透露得分。",
    "不得透露排序是否正确。",
    "不得透露入选原因。",
    "不得透露R/P/G、IIV或任何内部指标。",
    "不得评价教师能力等级。",
    "不得直接告诉教师标准答案。",
]

DEFAULT_FLOW = [
    "请教师回忆情境，并说明最先注意到什么。",
    "追问教师如何理解儿童行为背后的想法、需要或游戏意义。",
    "围绕教师重点选项或重点比较追问判断依据。",
    "请教师生成现场回应话术或后续支持做法。",
    "用中性语言小结教师观点并请其确认。",
]


def option_text(question_index: int, option: str) -> str:
    if option not in {"A", "B", "C", "D"}:
        return ""
    q = get_question(question_index)
    return f"教师{option}：{q.options.get(option, '')}"


def pair_text(question_index: int, pair: str) -> str:
    if not pair:
        return ""
    return "；".join(option_text(question_index, p) for p in pair.replace("/", "") if p in "ABCD")


def select_final_three(results: List[ItemResult], features: Dict[Tuple[str, int], ProcessFeature]) -> List[Dict[str, Any]]:
    """轻量版最终三题筛选。

    原型中采用“结果风险 + 相对偏离 + 过程信息”综合分。正式项目可替换为完整R/P/G程序。
    """
    by_user: Dict[str, List[ItemResult]] = defaultdict(list)
    for r in results:
        by_user[r.userOpenid].append(r)
    final_rows: List[Dict[str, Any]] = []
    for user, items in by_user.items():
        teacher_level = classify_teacher(items[0].mean_score if items else 0.0)
        scored = []
        for item in items:
            pf = features.get((item.userOpenid, item.questionIndex))
            revision = pf.revision_count if pf else 0
            process_signal = min(1.0, revision / 3.0)
            result_risk = (4 - item.score) / 4.0
            relative_deviation = item.abs_rd / 4.0
            hybrid = 0.45 * result_risk + 0.30 * relative_deviation + 0.25 * process_signal
            scored.append((hybrid, item))
        chosen = [x[1] for x in sorted(scored, key=lambda x: x[0], reverse=True)[:3]]
        # 能力覆盖：尽量不要三个同一主能力。
        for rank, item in enumerate(chosen, start=1):
            q = get_question(item.questionIndex)
            final_rows.append({
                "participantName": item.participantName,
                "userOpenid": item.userOpenid,
                "final_rank": rank,
                "questionIndex": item.questionIndex,
                "final_item_id": q.item_id,
                "item_title": q.title,
                "teacher_level": teacher_level,
                "score": item.score,
                "mean_score": item.mean_score,
                "RelativeDeviation": item.abs_rd / 4.0,
                "selection_reason": "原型综合分入选：结果风险、相对偏离与过程修正信号综合排序。正式版可替换为R/P/G最终三题算法。",
            })
    return final_rows


def build_safe_prompt(row: Dict[str, Any], pf: ProcessFeature) -> str:
    q = get_question(row["questionIndex"])
    parts = [
        f"请回忆第{q.question_index}题这个情境。",
        f"当时的情境是：{q.scenario}",
        "当时提供的做法包括：" + "；".join(option_text(q.question_index, o) for o in "ABCD") + "。",
    ]
    if pf.priorityPair:
        parts.append("可以围绕当时可能重点比较的做法追问：您当时是怎样比较以下两种做法的：" + pair_text(q.question_index, pf.priorityPair) + "？")
    elif pf.priorityOption:
        parts.append("可以围绕一个重点做法追问：您当时对这一做法（" + option_text(q.question_index, pf.priorityOption) + "）的考虑是什么？")
    else:
        parts.append("可以追问：您当时主要依据什么来排列这些做法？")
    parts.append("请只围绕情境理解、判断依据和选项比较提问，不要提及任何内部计算指标、得分、排名、入选原因或评价性判断。")
    return "".join(parts)


def build_task_card(row: Dict[str, Any], pf: ProcessFeature, knowledge_loader: KnowledgeLoader) -> Dict[str, Any]:
    q = get_question(row["questionIndex"])
    base_card: Dict[str, Any] = {
        "task_card_version": "v1.0",
        "participantName": row.get("participantName", ""),
        "userOpenid": row.get("userOpenid", ""),
        "final_rank": row.get("final_rank", ""),
        "item_id": q.item_id,
        "questionIndex": q.question_index,
        "item_title": q.title,
        "scenario": q.scenario,
        "options": q.options,
        "teacher_answer_profile": {
            "teacherFinalOrder": pf.teacherFinalOrder,
            "teacherInitialOrder": pf.teacherInitialOrder,
            "orderChanged": pf.orderChanged,
            "priorityOption": pf.priorityOption,
            "priorityPair": pf.priorityPair,
            "priorityOptionText": option_text(q.question_index, pf.priorityOption),
            "priorityPairText": pair_text(q.question_index, pf.priorityPair),
            "process_hint": pf.process_hint,
        },
        "ability_focus": {
            "primary_ability_type": q.primary_ability,
            "secondary_ability_type": q.secondary_ability,
            "interview_main_focus": "了解教师对该游戏情境的理解、判断依据与支持策略。",
            "interview_secondary_focus": "了解教师如何在儿童游戏兴趣、教育目标、规则与安全之间进行权衡。",
        },
        "interview_hypotheses": [
            "需要了解教师如何理解儿童行为背后的游戏意义。",
            "需要了解教师如何判断教师介入的时机与方式。",
            "需要了解教师能否生成具体、可实施的支持策略。",
        ],
        "must_obtain_evidence": [
            "教师如何理解儿童在情境中的行为。",
            "教师如何比较不同回应方式。",
            "教师如何说明自己的判断依据。",
            "教师能否给出具体现场回应话术。",
        ],
        "recommended_interview_flow": DEFAULT_FLOW,
        "recommended_probes": [],
        "forbidden_disclosure": FORBIDDEN_DISCLOSURE,
    }
    try:
        item_knowledge = knowledge_loader.get(q.question_index)
        rule_fields = rules_to_task_fields(item_knowledge.ai_rules(), base_card)
        if rule_fields.get("interview_main_focus"):
            base_card["ability_focus"]["interview_main_focus"] = rule_fields["interview_main_focus"]
        if rule_fields.get("interview_secondary_focus"):
            base_card["ability_focus"]["interview_secondary_focus"] = rule_fields["interview_secondary_focus"]
        for key in ("interview_hypotheses", "must_obtain_evidence", "recommended_interview_flow", "recommended_probes"):
            values = rule_fields.get(key)
            if values:
                base_card[key] = values
    except Exception as exc:
        base_card["knowledge_warning"] = f"知识库规则读取失败，已使用默认规则：{exc}"
    return base_card


def build_rows(final_rows: List[Dict[str, Any]], features: Dict[Tuple[str, int], ProcessFeature], knowledge_loader: KnowledgeLoader) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    safe_rows: List[Dict[str, Any]] = []
    task_rows: List[Dict[str, Any]] = []
    for row in final_rows:
        q = get_question(row["questionIndex"])
        pf = features.get((row["userOpenid"], row["questionIndex"])) or ProcessFeature(row["userOpenid"], row["questionIndex"], teacherFinalOrder="")
        task_card = build_task_card(row, pf, knowledge_loader)
        task_json = json_dumps_cn(task_card)
        safe = {
            "participantName": row.get("participantName", ""),
            "userOpenid": row.get("userOpenid", ""),
            "final_rank": row.get("final_rank", ""),
            "final_item_id": q.item_id,
            "questionIndex": q.question_index,
            "item_title": q.title,
            "scenarioText": q.scenario,
            "optionA": q.options.get("A", ""),
            "optionB": q.options.get("B", ""),
            "optionC": q.options.get("C", ""),
            "optionD": q.options.get("D", ""),
            "priorityOption": pf.priorityOption,
            "priorityPair": pf.priorityPair,
            "priorityOptionText": option_text(q.question_index, pf.priorityOption),
            "priorityPairText": pair_text(q.question_index, pf.priorityPair),
            "safeInterviewPrompt": build_safe_prompt(row, pf),
            "forbiddenDisclosureReminder": "访谈时不得向教师透露任何内部计算指标、得分、排名、题目入选原因或评价性判断。",
        }
        task = {
            **{k: safe.get(k, "") for k in safe},
            "task_card_json": task_json,
            "task_card_version": "v1.0",
            "teacherFinalOrder": pf.teacherFinalOrder,
            "teacherInitialOrder": pf.teacherInitialOrder,
            "orderChanged": str(pf.orderChanged),
            "primary_ability_type": q.primary_ability,
            "secondary_ability_type": q.secondary_ability,
            "interview_main_focus": task_card["ability_focus"].get("interview_main_focus", ""),
            "interview_secondary_focus": task_card["ability_focus"].get("interview_secondary_focus", ""),
            "interview_hypotheses": json_dumps_cn(task_card.get("interview_hypotheses", [])),
            "must_obtain_evidence": json_dumps_cn(task_card.get("must_obtain_evidence", [])),
            "recommended_interview_flow": json_dumps_cn(task_card.get("recommended_interview_flow", [])),
            "recommended_probes": json_dumps_cn(task_card.get("recommended_probes", [])),
            "forbidden_disclosure": json_dumps_cn(FORBIDDEN_DISCLOSURE),
        }
        safe_rows.append({col: safe.get(col, "") for col in AI_SAFE_COLUMNS})
        task_rows.append({col: task.get(col, "") for col in AI_TASK_CARD_COLUMNS})
    return safe_rows, task_rows


def write_materials_xlsx(output_path: str | Path, safe_rows: List[Dict[str, Any]], task_rows: List[Dict[str, Any]]) -> None:
    wb = Workbook()
    ws1 = wb.active
    ws1.title = "AI安全访谈材料"
    _write_table(ws1, AI_SAFE_COLUMNS, safe_rows)
    ws2 = wb.create_sheet("AI后台任务卡")
    _write_table(ws2, AI_TASK_CARD_COLUMNS, task_rows)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    wb.save(output_path)


def _write_table(ws, columns: List[str], rows: List[Dict[str, Any]]) -> None:
    header_fill = PatternFill("solid", fgColor="D9EAF7")
    for c_idx, col in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=c_idx, value=col)
        cell.font = Font(bold=True)
        cell.fill = header_fill
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    for r_idx, row in enumerate(rows, start=2):
        for c_idx, col in enumerate(columns, start=1):
            cell = ws.cell(row=r_idx, column=c_idx, value=row.get(col, ""))
            cell.alignment = Alignment(wrap_text=True, vertical="top")
    for c_idx, col in enumerate(columns, start=1):
        width = min(max(len(col) + 4, 16), 60)
        if col in {"task_card_json", "safeInterviewPrompt"}:
            width = 80
        ws.column_dimensions[ws.cell(row=1, column=c_idx).column_letter].width = width


def prepare_materials(results_csv: str, logs_csv: str | None, knowledge_dir: str, output_dir: str) -> Dict[str, Any]:
    out_dir = ensure_dir(output_dir)
    engine = ScoringEngine()
    results = engine.parse_results_csv(results_csv)
    features = build_process_features(results, logs_csv)
    knowledge_loader = KnowledgeLoader(knowledge_dir)
    knowledge_loader.load_all()
    final_rows = select_final_three(results, features)
    safe_rows, task_rows = build_rows(final_rows, features, knowledge_loader)
    materials_path = out_dir / "AI访谈材料.xlsx"
    write_materials_xlsx(materials_path, safe_rows, task_rows)
    # 同时保存JSON，便于后端无需读取Excel即可运行。
    task_json_path = out_dir / "ai_task_cards.json"
    task_json_path.write_text(json_dumps_cn(task_rows), encoding="utf-8")
    return {
        "materials_path": str(materials_path),
        "task_json_path": str(task_json_path),
        "teacher_count": len({r.userOpenid for r in results}),
        "task_card_count": len(task_rows),
    }
