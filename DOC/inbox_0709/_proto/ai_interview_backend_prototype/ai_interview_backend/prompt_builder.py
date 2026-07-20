# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from typing import Any, Dict, List


SYSTEM_PROMPT = """
你是一名幼儿园教师游戏支持与引导能力AI访谈助手。
你的任务不是评分、纠错或培训，而是通过温和、专业、连续的追问，了解教师在具体游戏情境中的儿童理解、判断依据、价值权衡、介入时机和支持策略。

必须遵守：
1. 每次只问一个问题。
2. 不得向教师透露得分、排序是否正确、入选原因、R/P/G、IIV、能力等级或任何内部评价。
3. 不得直接告诉教师标准答案。
4. 不得长篇讲解理论，不要把访谈变成讲课。
5. 不使用审问式、责备式、评价式语言。
6. 如果教师回答笼统，追问具体现场语言和行动。
7. 如果教师回答已经充分，进入下一个关键点。
8. 全程围绕当前情境，不随意扩展到无关话题。
""".strip()


AVOID_QUESTIONS = [
    "避免评价式问法，例如：你为什么没有选择更合适的做法？",
    "避免教学式输出，例如：正确做法应该是……",
    "避免一次问多个问题。",
    "避免过早总结教师能力，例如：看来您儿童视角不足。",
]


QUESTION_LIBRARY = {
    "情境理解": [
        "您当时最先注意到这个情境中的什么？",
        "您觉得孩子这个行为背后可能有什么想法、需要或游戏意义？",
        "如果这是您班上的孩子，您会先观察什么？",
    ],
    "价值权衡": [
        "这里似乎同时涉及儿童兴趣和教师的教育目标，您当时更看重什么？",
        "您觉得这几种做法的主要差别在哪里？",
        "您会怎样在儿童自主、游戏兴趣、规则和安全之间作取舍？",
    ],
    "选项比较": [
        "您当时怎样比较这两个做法？",
        "您觉得这个做法的优点是什么？可能的不足是什么？",
        "如果把这个做法放在前面，您最看重的依据是什么？",
    ],
    "过程回忆": [
        "这几种做法确实比较接近，您回想一下，当时有没有在哪两个做法之间比较犹豫？",
        "如果您后来调整过想法，是什么让您改变了判断？",
        "这道题最难判断的地方在哪里？",
    ],
    "现场行动": [
        "如果您就在现场，您会对孩子说的第一句话是什么？",
        "如果孩子这样回应，您下一步会怎么接？",
        "您会不会调整材料、同伴、空间或规则？具体会怎么调？",
    ],
    "反事实追问": [
        "如果孩子的回应和您预想的不一样，您会怎么继续接？",
        "如果其他孩子也跟着出现类似表现，您会怎么处理？",
        "如果现场同时存在安全或秩序风险，您会怎样既保护游戏兴趣又处理风险？",
    ],
}


STAGE_SEQUENCE = ["opening", "situation_understanding", "option_comparison", "hypothesis_probe", "strategy_generation", "summary_confirm"]
STAGE_LABELS = {
    "opening": "开场定位",
    "situation_understanding": "情境理解",
    "option_comparison": "选项比较",
    "hypothesis_probe": "专业假设验证",
    "strategy_generation": "现场策略生成",
    "summary_confirm": "小结确认",
}


def build_interview_messages(task_card: Dict[str, Any], knowledge_snippets: str, dialogue_history: List[Dict[str, str]], stage: str) -> List[Dict[str, str]]:
    user_content = f"""
【当前访谈阶段】
{STAGE_LABELS.get(stage, stage)}

【当前题AI后台任务卡】
{json.dumps(task_card, ensure_ascii=False, indent=2)}

【当前题知识库片段】
{knowledge_snippets}

【推荐问题库】
{json.dumps(QUESTION_LIBRARY, ensure_ascii=False, indent=2)}

【访谈中应避免的问题】
{json.dumps(AVOID_QUESTIONS, ensure_ascii=False, indent=2)}

【当前访谈历史】
{json.dumps(dialogue_history, ensure_ascii=False, indent=2)}

【当前任务】
请根据任务卡、知识库和教师上一轮回答，生成下一句访谈问题。
要求：自然、温和、具体；每次只问一个问题；不要透露任何内部指标或评价；不要给标准答案。
""".strip()
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_content}]
    return messages


def build_opening_question(task_card: Dict[str, Any]) -> str:
    title = task_card.get("item_title", "这个情境")
    return f"我们回到刚才“{title}”这个情境。这里不是核对答案，也不讨论分数。我主要想了解您当时是怎样理解孩子的表现、怎样考虑教师回应方式的。您当时最先注意到的是什么？"


def build_evidence_messages(task_card: Dict[str, Any], knowledge_snippets: str, dialogue_history: List[Dict[str, str]]) -> List[Dict[str, str]]:
    schema = {
        "child_perspective_evidence": "教师如何理解儿童游戏行为、兴趣、情绪或叙事意义。",
        "intervention_timing": "教师如何判断观察、等待、介入、引导或延后讨论的时机。",
        "value_balance": "教师如何平衡儿童自主、游戏兴趣、安全规则、教育目标和价值引导。",
        "strategy_generation": "教师能否生成具体现场语言、行动步骤、材料/空间/同伴支持或后续延展。",
        "key_quotes": "教师关键原话，保留1-3句。",
        "unresolved_questions": "访谈后仍未确认或前后不一致之处。",
        "ability_inference": "后台能力判断，不给教师端直接展示。",
        "support_suggestion": "后续个别化支持建议。",
        "confidence": "high/medium/low，说明证据充分程度。",
    }
    user_content = f"""
请基于当前题AI后台任务卡、知识库片段和完整访谈历史，生成结构化证据表。
必须输出合法JSON，不要使用Markdown代码块，不要添加JSON以外文字。

【输出字段定义】
{json.dumps(schema, ensure_ascii=False, indent=2)}

【当前题AI后台任务卡】
{json.dumps(task_card, ensure_ascii=False, indent=2)}

【当前题知识库片段】
{knowledge_snippets}

【完整访谈历史】
{json.dumps(dialogue_history, ensure_ascii=False, indent=2)}
""".strip()
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_content}]
