#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
导师版 R/P/G/最终3题 AI访谈候选题筛选程序

配置版本：2026-07-15 新题序＋新赋分
题序依据：10题筛选_小程序题目顺序.docx
赋分依据：10题赋分_修改顺序后.xlsx

依据四份算法说明实现：
001 结果性偏离 R 分：每位教师选2题
002 过程性 P-IVI：每位教师选2题
003 结果-过程关系 G 分：每位教师选2题
004 R/P/G整合：每位教师最终选3题

运行示例：
    python3 calculate_advisor_rpg_final.py exam_results_all.csv logs_all.csv -o outputs/advisor_run

输入文件格式沿用原测评平台导出的结果数据与过程日志数据。
本程序为独立单文件版本，不依赖其他自定义 Python 文件。
"""

import argparse
import csv
import json
import math
import re
import zipfile
from collections import Counter, defaultdict
from html import escape
from pathlib import Path


IDLE_THRESHOLD_SECONDS = 120.0
HIGH_MEAN_THRESHOLD = 3.0
LOW_MEAN_THRESHOLD = 2.0

REQUIRED_RESULTS_COLUMNS = {"participantName", "userOpenid", "answers"}
REQUIRED_LOG_COLUMNS = {"userOpenid", "questionIndex", "timestamp", "action"}

SCORE_CSV = """选项组合,01赋分,02赋分,03赋分,04赋分,05赋分,06赋分,07赋分,08赋分,09赋分,10赋分
ABCD,4,2,2,0,2,0,0,1,0,2
ABDC,3,2,4,2,2,0,1,2,3,2
ACBD,4,3,1,1,2,0,1,2,0,1
ACDB,2,4,1,1,1,0,1,2,1,1
ADBC,1,2,4,1,1,0,1,2,2,2
ADCB,1,3,3,2,0,1,3,3,1,1
BACD,2,2,2,1,3,0,0,1,2,2
BADC,1,1,2,4,3,0,2,1,2,3
BCAD,3,1,4,2,2,1,1,0,1,2
BCDA,1,1,4,3,1,3,1,1,0,2
BDAC,1,1,4,4,4,2,2,2,2,4
BDCA,0,0,2,4,3,3,0,1,1,3
CABD,4,2,3,1,1,1,2,1,0,1
CADB,2,3,1,1,0,1,4,2,1,0
CBAD,3,2,3,2,0,2,2,1,1,1
CBDA,1,1,1,1,1,4,2,1,0,2
CDAB,2,2,0,2,1,2,4,2,2,1
CDBA,1,2,0,4,1,3,1,2,2,1
DABC,1,2,3,1,2,3,2,3,1,2
DACB,0,2,3,1,2,2,3,4,2,2
DBAC,0,1,3,3,3,3,2,2,1,3
DBCA,0,1,3,3,1,4,1,2,2,2
DCAB,0,2,0,2,0,3,1,3,2,1
DCBA,0,1,2,3,2,4,1,2,4,2
"""

# 按“10题筛选_小程序题目顺序.docx”的当前小程序题序映射。
# 能力类型随情境一起迁移，确保题号、题干、选项、赋分和能力覆盖类型一致。
ABILITY_MAP = {
    1: {"item_id": "Q1", "item_title": "篮球架玩水", "primary": "B 自主游戏与规则/安全/价值平衡", "secondary": "A 游戏意义理解"},
    2: {"item_id": "Q2", "item_title": "频繁求助", "primary": "C 观察诊断与介入时机", "secondary": "D 支架策略"},
    3: {"item_id": "Q3", "item_title": "区域停留短", "primary": "C 观察诊断与介入时机", "secondary": "A 儿童视角"},
    4: {"item_id": "Q4", "item_title": "未参与小组建构", "primary": "D 支架策略与游戏推进", "secondary": "E 共同游戏组织"},
    5: {"item_id": "Q5", "item_title": "消防员救火开心", "primary": "A 游戏意义理解与儿童视角", "secondary": "B 价值平衡"},
    6: {"item_id": "Q6", "item_title": "材料选择无层次", "primary": "D 支架策略与游戏推进", "secondary": "C 观察诊断"},
    7: {"item_id": "Q7", "item_title": "艾莎公主不运动", "primary": "D 支架策略与游戏推进", "secondary": "A 儿童视角/B 目标平衡"},
    8: {"item_id": "Q8", "item_title": "引水难题未解", "primary": "C 观察诊断与介入时机", "secondary": "D 探究支架"},
    9: {"item_id": "Q9", "item_title": "飞行棋各走各的", "primary": "E 共同游戏组织与规则共建", "secondary": "B 规则平衡"},
    10: {"item_id": "Q10", "item_title": "跳绳秩序混乱", "primary": "E 共同游戏组织与规则共建", "secondary": "B 安全秩序"},
}

QUESTION_CONTENT = {
    1: {
        "scenario": "操场上新安装了一些篮球架，幼儿经常在这里投篮。某天户外活动时，几名幼儿带着画笔和水桶来到这里，他们先是快乐地粉刷篮球架，之后开始往篮框里灌水，有的从上面灌，有的在下面接，忙的不亦乐乎，俨然这里成为了玩水的场地。",
        "options": {
            "A": "看到幼儿玩得很开心，不干预他们的玩水行为，待兴趣减弱后再讨论玩水的适宜性。",
            "B": "表扬幼儿的新发现，并询问在篮球架旁玩水是否合适，提议幼儿可以换个地方玩水。",
            "C": "参与到幼儿的“粉刷”游戏中，逐步引导幼儿到适宜玩水的地方继续开展游戏。",
            "D": "提醒幼儿篮球架是用于开展运动的，与其他幼儿一起召唤他们打篮球，转移他们的关注点。",
        },
    },
    4: {
        "scenario": "大班建构活动中，睿睿和其他幼儿计划一起搭积木大桥，他们讨论了搭建方法，并进入区域开始搭建。就在其他幼儿在认真搭建时，睿睿发现了一块长条木板，他一会儿在地上推着走，一会儿当枪使，没有再参与小组的搭建。",
        "options": {
            "A": "继续观察，后续分享中支持睿睿思考如何把长条木板融入小组的建构中。",
            "B": "肯定睿睿的创造性玩法，询问他长条板能否当桥面，引导他参与到搭桥任务中。",
            "C": "引导睿睿回顾计划，建议他先完成共同任务，长条木板可以等自由游戏时再玩。",
            "D": "看到睿睿玩得开心，暂不介入，等下一次活动时再提醒他根据计划开展游戏。",
        },
    },
    6: {
        "scenario": "大班上学期，张老师在建构区投放了按图搭建的游戏材料，并提供了不同星级难度的任务卡供幼儿选择，但有的幼儿一上来就选择高难度的三星级任务卡，结果不能顺利完成任务；而有的幼儿始终选择低难度的一星级任务卡。这天，浩浩又连续选择了几张一星级任务卡，很快就完成了任务。",
        "options": {
            "A": "调整任务卡提供方式，在游戏开始前根据幼儿的能力水平有针对性地发放任务卡。",
            "B": "暂不介入，尊重幼儿的自主选择和游戏体验，只要完成任务就是一种经验积累。",
            "C": "调整任务卡呈现方式，如增加“我想挑战”等提示，鼓励幼儿选择不同星级的挑战。",
            "D": "和浩浩回顾已完成的任务，比较不同星级的难度，邀请他选择稍有挑战的任务。",
        },
    },
    2: {
        "scenario": "中班区域活动时，小明选择了建构区。玩了一会儿，他跑到老师面前说“老师，我不会搭……帮帮我吧”，教师问他需要什么帮助时，他一边说我不会搭，一边却很快地将房子从一层积木加高到了两层。看小明专注搭建后，老师就离开建构区了。可是没一会，小明又找了老师好几次，说“老师，帮帮我吧，我不会搭”。",
        "options": {
            "A": "鼓励小明独立搭建，引导他思考接下来如何搭建，及时表扬他的努力。",
            "B": "先示范搭建关键部分，请小明观察方法，再鼓励他照着继续搭建。",
            "C": "在旁观察小明的搭建过程，并适时反馈，帮助他理清搭建步骤。",
            "D": "帮小明回顾已搭建完成的部分，指导他设定小目标，尝试自己实现。",
        },
    },
    5: {
        "scenario": "近几天，中班的幼儿十分热衷于在区域游戏时间玩“消防员救火”的游戏。游戏结束后的交流活动中，老师问幼儿最想分享什么时，阳阳说“娃娃家着火了，好开心啊！”。",
        "options": {
            "A": "抓住教育契机，向幼儿耐心解释真实的火灾会造成物品损失和人员伤亡。",
            "B": "询问幼儿开心的是“着火”本身，还是消防员成功救火、娃娃家的人得救？",
            "C": "引导幼儿思考“娃娃家着火”值不值得开心，帮助他们认识真实火灾是危险的。",
            "D": "请阳阳讲讲娃娃家着火后发生了什么、为什么开心，借此理解幼儿的游戏体验。",
        },
    },
    3: {
        "scenario": "小班幼儿瑶瑶在区域活动时，一会儿在娃娃家切切菜，一会儿到美工区搓搓橡皮泥，一会儿又开心地跑到其它区域游戏，在任何一个区域停留时间都不超过三分钟。",
        "options": {
            "A": "提议瑶瑶完成某项游戏任务，如在娃娃家做菜，请他活动小结时分享。",
            "B": "游戏前提醒区域活动规则，活动结束后表扬区域游戏规则遵守得好的小朋友。",
            "C": "仔细观察瑶瑶在不同区域的游戏情况，分析他发生迅速转移的原因。",
            "D": "以同伴的身份陪伴瑶瑶在某一区域游戏，待他专注游戏后再离开。",
        },
    },
    9: {
        "scenario": "大班区域游戏中，轩轩和小宇一起玩飞行棋，他们将棋子摆好后，各自拿了一个骰子开始投，小宇说：“该我走。”轩轩说：“明明该我走！”相持不下，于是两人各拿一个骰子，自顾自地走自己的棋。",
        "options": {
            "A": "耐心讲解共同游戏的规则，再以“棋手”身份加入游戏进行示范引导。",
            "B": "暂不介入，继续观察游戏进展，待区域小结时请幼儿分享游戏中的体验和问题。",
            "C": "拿走一个骰子，请幼儿商量只有一个骰子的共同游戏规则，达成一致后再开始游戏。",
            "D": "待幼儿体验一轮各走各的游戏后，询问幼儿的游戏体验，提示共同游戏规则的作用。",
        },
    },
    10: {
        "scenario": "周三下午，大五班的幼儿正自发进行跳绳游戏。李老师观察后发现，挤在一起跳绳的幼儿人数较多，整个场面十分混乱，幼儿很容易出现碰撞现象。此外，由于当“柱子”的幼儿很久才能轮上跳绳，因此也显得很不耐烦。",
        "options": {
            "A": "请幼儿暂停游戏，将幼儿分成多个小组并引导他们以小组为单位分区域开展游戏。",
            "B": "请幼儿说一说跳绳活动中存在的问题，并邀请幼儿一起设置跳绳的规则。",
            "C": "提供更多数量和不同种类的跳绳，并言语引导幼儿分组分区同时进行跳绳游戏。",
            "D": "暂不介入，活动分享时通过照片或视频回放引导幼儿发现问题并商议解决办法。",
        },
    },
    7: {
        "scenario": "小班的一次户外运动，有几个女孩子从一开始就没有选择任何体育活动项目，而是聚在一起坐在地上玩“艾莎公主”的游戏，比一比谁的鞋子最漂亮，谁的魔法最厉害。",
        "options": {
            "A": "询问幼儿没有参与运动的原因，提供丰富的活动材料吸引幼儿参与运动活动。",
            "B": "提醒幼儿现在是运动时间，请他们等自由游戏时间再一起玩“艾莎公主”的游戏。",
            "C": "利用艾莎公主的鞋子设计走、跑、跳等活动，并以参与者的身份邀请幼儿一起参与运动。",
            "D": "肯定幼儿自主游戏的行为，言语引导幼儿穿着“漂亮的鞋子”参与运动。",
        },
    },
    8: {
        "scenario": "中班上学期，幼儿在“引水游戏”中遇到了难题——水无法被引到竹片管道上。他们不断调整竹片拼接的方式，却始终没能成功，即竹片一头高于出水管道，阻碍了引流。渐渐地幼儿的探索兴趣也减弱了，有的开始玩水，有的甚至离开了水池。",
        "options": {
            "A": "示范正确的引水方法，请幼儿注意观察并说说引水的要领，再自己试一试。",
            "B": "加入幼儿的探索，引导他们观察水流受阻的位置，一起尝试调整竹片的摆放方式。",
            "C": "组织幼儿就游戏困难进行讨论，寻找解决问题的方案，引导幼儿再次尝试。",
            "D": "投放更多辅助引水的材料，重新激起幼儿的探索兴趣，继续观察游戏进展。",
        },
    },
}

SCENARIO_FOLLOWUP_QUESTIONS = {
    1: [
        "这个情境里，孩子把篮球架变成玩水场地，你当时更关注他们的游戏兴趣、器械用途，还是安全与场地适宜性？",
        "如果既想保护孩子的探索兴趣，又要回应篮球架原本的运动功能，你觉得教师可以怎样衔接？",
    ],
    4: [
        "睿睿离开了原来的搭桥计划去玩长条木板，你当时怎样理解他的行为：是偏离共同任务，还是出现了新的游戏线索？",
        "面对共同建构计划和幼儿临时兴趣之间的变化，你觉得教师什么时候应该介入，什么时候可以继续观察？",
    ],
    6: [
        "浩浩反复选择一星任务卡时，你当时更想尊重他的自主选择，还是推动他尝试更有挑战的任务？",
        "你觉得教师应该怎样判断幼儿是需要安全感、缺少挑战意识，还是任务卡呈现方式本身需要调整？",
    ],
    2: [
        "小明一边说不会搭，一边又能继续加高房子，你当时怎样判断他真正需要的帮助是什么？",
        "面对幼儿反复求助，你觉得教师怎样支持，既不替代幼儿完成，又能帮助他继续推进游戏？",
    ],
    5: [
        "阳阳说娃娃家着火了很开心时，你当时更关注真实火灾的危险教育，还是先理解他在游戏里的开心来自哪里？",
        "你觉得教师怎样回应，既不否定幼儿的游戏体验，又能引导他们理解真实火灾的意义？",
    ],
    3: [
        "瑶瑶在多个区域快速转换时，你当时会先把它看作注意力不集中、规则问题，还是一种探索不同材料的方式？",
        "如果你在现场，你会先观察哪些信息来判断是否需要介入？",
    ],
    9: [
        "两个孩子各走各的棋时，你当时更关注共同游戏规则的建立，还是先让他们体验这种玩法会带来什么问题？",
        "你觉得教师怎样帮助幼儿从各玩各的，过渡到真正的共同游戏？",
    ],
    10: [
        "跳绳现场混乱且可能碰撞时，你当时更倾向于立即组织秩序，还是先让幼儿自己发现问题？",
        "在安全风险和幼儿自主制定规则之间，你觉得教师应该怎样把握介入时机？",
    ],
    7: [
        "几个女孩在户外运动时间玩艾莎公主时，你当时更关注运动目标，还是关注她们正在生成的角色游戏兴趣？",
        "如果要把艾莎公主游戏和运动活动连接起来，你觉得教师可以怎样做才不显得生硬？",
    ],
    8: [
        "孩子们引水失败、兴趣减弱时，你当时更倾向于直接示范方法，还是继续支持他们自己发现水流受阻的原因？",
        "你觉得教师怎样提供支架，既能帮助问题解决，又保留幼儿继续探究的空间？",
    ],
}


OUTPUT_WARNING = (
    "访谈提醒：本程序用于筛选值得访谈的情境题，不用于向教师反馈测评成绩。"
    "后续AI访谈或人工访谈时，不得向教师透露得分、排名、R/P/G分、IIV或任何评价性结果。"
)

SAFE_OUTPUT_WARNING = (
    "访谈提醒：本表仅供生成中性访谈提问。访谈时不得向教师透露任何内部计算指标、"
    "得分、排名、题目入选原因或评价性判断。"
)


R_COLUMNS = [
    "participantName", "userOpenid", "teacher_level", "mean_score", "candidate_rank",
    "item_id", "questionIndex", "item_title", "scenarioText",
    "optionA", "optionB", "optionC", "optionD",
    "item_score", "RD", "abs_RD",
    "candidate_type", "deviation_strength", "selection_reason", "tie_break_reason",
    "interview_orientation",
]

P_DETAIL_COLUMNS = [
    "participantName", "userOpenid", "item_id", "questionIndex", "item_title",
    "scenarioText", "optionA", "optionB", "optionC", "optionD",
    "raw_item_time_sec", "effective_item_time_sec", "effective_first_response_time_sec",
    "effective_post_first_time_sec", "revision_count", "action_count",
    "first_position_change_count", "last_position_change_count", "top_bottom_swap_count",
    "unique_state_count", "repeated_state_count", "backtracking_count", "oscillation_count",
    "priorityOption", "priorityPair", "priorityOptionText", "priorityPairText",
    "max_idle_gap_sec", "time_removed_sec", "interruption_flag",
    "F_score", "M_score", "B_score", "O_score", "P_IVI",
    "selection_status", "process_type", "process_labels", "suggested_interview_focus",
]

P_SELECTED_COLUMNS = [
    "participantName", "userOpenid", "candidate_rank", "item_id", "questionIndex",
    "item_title", "scenarioText", "optionA", "optionB", "optionC", "optionD",
    "P_IVI", "F_score", "M_score", "B_score", "O_score",
    "interruption_flag", "main_process_trigger", "process_labels",
    "priorityOption", "priorityPair", "priorityOptionText", "priorityPairText",
    "suggested_interview_focus", "time_correction_note",
]

G_COLUMNS = [
    "participantName", "userOpenid", "teacher_level", "candidate_rank",
    "item_id", "questionIndex", "item_title", "scenarioText",
    "optionA", "optionB", "optionC", "optionD",
    "item_score", "mean_score", "RD",
    "P_IVI", "process_type", "relation_type", "G_candidate_score",
    "selection_reason", "interview_focus",
]

FINAL_COLUMNS = [
    "participantName", "userOpenid", "final_rank", "final_item_id", "questionIndex",
    "item_title", "scenarioText", "optionA", "optionB", "optionC", "optionD",
    "primary_ability_type", "secondary_ability_type",
    "source_summary", "source_count", "R_rank", "P_rank", "G_rank",
    "ResultRisk", "RelativeDeviation", "ProcessConflict", "RevisionSignal",
    "TimeSignal", "OptionFocus", "P_IVI_norm", "IIV_classic", "IIV_hybrid",
    "FES", "RS", "selection_reason", "coverage_role", "interview_focus",
    "priorityOption", "priorityPair", "priorityOptionText", "priorityPairText",
    "safeInterviewPrompt", "replacement_note", "forbiddenDisclosureReminder",
]

AI_SAFE_COLUMNS = [
    "participantName", "userOpenid", "final_rank", "final_item_id", "questionIndex",
    "item_title", "scenarioText", "optionA", "optionB", "optionC", "optionD",
    "priorityOption", "priorityPair", "priorityOptionText", "priorityPairText",
    "safeInterviewPrompt", "forbiddenDisclosureReminder",
]

IIV_DETAIL_COLUMNS = [
    "participantName", "userOpenid", "teacher_level", "mean_score", "total_score",
    "item_id", "questionIndex", "item_title", "scenarioText",
    "optionA", "optionB", "optionC", "optionD",
    "primary_ability_type", "secondary_ability_type", "chosen_comb",
    "S_initial", "S_final", "S_max", "S_min",
    "ResultRisk", "RelativeDeviation", "RD", "abs_RD",
    "Gain", "Volatility", "Deterioration", "Recovery", "RevisionSignal",
    "ProcessConflict", "OptionFocus", "P_IVI", "P_IVI_norm",
    "effective_first_response_time_sec", "effective_post_first_time_sec",
    "effective_item_time_sec", "Z_First", "Z_Post", "TimeSignal_raw_z", "TimeSignal",
    "action_count", "revision_count", "first_position_change_count",
    "last_position_change_count", "top_bottom_swap_count", "unique_state_count",
    "repeated_state_count", "backtracking_count", "oscillation_count",
    "max_idle_gap_sec", "time_removed_sec", "interruption_flag",
    "priorityOption", "priorityPair", "priorityOptionText", "priorityPairText",
    "process_type", "process_labels", "suggested_interview_focus",
    "IIV_classic", "IIV_hybrid", "IIV_interpretation",
]


def item_meta(q):
    meta = ABILITY_MAP.get(int(q), {})
    content = QUESTION_CONTENT.get(int(q), {})
    options = content.get("options", {})
    return {
        "item_id": meta.get("item_id", f"Q{int(q)}"),
        "item_title": meta.get("item_title", f"第{int(q)}题"),
        "primary": meta.get("primary", ""),
        "secondary": meta.get("secondary", ""),
        "scenarioText": content.get("scenario", ""),
        "optionA": options.get("A", ""),
        "optionB": options.get("B", ""),
        "optionC": options.get("C", ""),
        "optionD": options.get("D", ""),
    }


def meta_output_fields(meta):
    return {
        "scenarioText": meta.get("scenarioText", ""),
        "optionA": meta.get("optionA", ""),
        "optionB": meta.get("optionB", ""),
        "optionC": meta.get("optionC", ""),
        "optionD": meta.get("optionD", ""),
    }


def strip_trailing_punctuation(text):
    return re.sub(r"[。！？；;,.，、\s]+$", "", text or "")


def option_text(question_index, option, strip_end=False):
    option = (option or "").strip().upper()
    if option not in {"A", "B", "C", "D"}:
        return ""
    options = QUESTION_CONTENT.get(int(question_index), {}).get("options", {})
    text = options.get(option, "")
    if strip_end:
        text = strip_trailing_punctuation(text)
    return f"教师{option}：{text}" if text else f"教师{option}"


def pair_text(question_index, pair, strip_end=False):
    if not pair:
        return ""
    options = re.findall(r"[ABCD]", str(pair).upper())
    return "；".join(option_text(question_index, opt, strip_end=strip_end) for opt in options)


def option_focus_from_trajectory(question_index, trajectory, moved_options, transitions):
    priority_option = ""
    best_score = 0
    if trajectory:
        initial = trajectory[0]
        final = trajectory[-1]
        move_counts = Counter(moved_options)
        for opt in "ABCD":
            if opt not in initial or opt not in final:
                continue
            shift = abs((initial.index(opt) + 1) - (final.index(opt) + 1))
            score = move_counts.get(opt, 0) * 10 + shift
            if score > best_score:
                priority_option = opt
                best_score = score

    pair_counter = Counter()
    for prev, cur in transitions:
        if not prev or not cur:
            continue
        changed = [
            opt
            for opt in "ABCD"
            if opt in prev and opt in cur and prev.index(opt) != cur.index(opt)
        ]
        for i in range(len(changed)):
            for j in range(i + 1, len(changed)):
                pair_counter["/".join(sorted((changed[i], changed[j])))] += 1
    priority_pair = pair_counter.most_common(1)[0][0] if pair_counter else ""
    return priority_option, priority_pair


def build_safe_interview_prompt(row):
    q = row["questionIndex"]
    scenario_questions = SCENARIO_FOLLOWUP_QUESTIONS.get(int(q), [])
    parts = [
        f"请回忆第{q}题这个情境。",
        f"当时的情境是：{row.get('scenarioText', '')}",
        "当时提供的做法包括："
        + "；".join(option_text(q, opt, strip_end=True) for opt in "ABCD")
        + "。",
    ]
    if scenario_questions:
        parts.append("可以先从这个情境本身追问：" + "；".join(scenario_questions) + "。")
    if row.get("priorityPair"):
        parts.append(
            "然后可围绕其作答过程中的重点比较追问：你当时是怎样比较以下两种做法的："
            + pair_text(q, row["priorityPair"], strip_end=True)
            + "？"
        )
    elif row.get("priorityOption"):
        parts.append(
            "然后可围绕其作答过程中的重点选项追问：你当时对这一做法（"
            + option_text(q, row["priorityOption"], strip_end=True)
            + "）的考虑是什么？"
        )
    else:
        parts.append("然后可追问：你当时主要依据什么来排列这些做法？")
    parts.append("如果教师提到调整过顺序，再追问：是什么信息或想法让你改变了当时的排序？")
    parts.append("请只围绕情境理解、判断依据和选项比较提问，不要提及任何内部计算指标、得分、排名、入选原因或评价性判断。")
    return "".join(parts)


def read_csv_dicts(path):
    path = Path(path)
    last_error = None
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            with path.open("r", encoding=encoding, newline="") as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError as exc:
            last_error = exc
    raise RuntimeError(f"无法读取 CSV 文件编码：{path}") from last_error


def validate_columns(rows, required, label):
    if not rows:
        raise ValueError(f"{label}为空，无法计算。")
    missing = sorted(required - set(rows[0].keys()))
    if missing:
        raise ValueError(f"{label}缺少必要列：{', '.join(missing)}")


def build_score_dict():
    score_dict = {}
    for row in csv.DictReader(SCORE_CSV.strip().splitlines()):
        comb = row["选项组合"].strip()
        for q in range(1, 11):
            score_dict[(q, comb)] = int(row[f"{q:02d}赋分"])
    return score_dict


def parse_float(value, default=None):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_int(value, default=None):
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def clean_sort_value(value):
    if value is None:
        return None
    value = str(value).strip().strip('"').strip("'")
    if not value or value.lower() == "nan":
        return None
    letters = re.findall(r"[ABCD]", value.upper())
    if len(letters) == 4:
        return "".join(letters)
    return None


def score_of(score_dict, question_index, comb):
    if not comb:
        return None
    return score_dict.get((question_index, comb))


def parse_results(results_rows, score_dict):
    idx_to_char = {0: "A", 1: "B", 2: "C", 3: "D"}
    parsed = []
    for row_num, row in enumerate(results_rows, start=2):
        participant = row.get("participantName", "")
        user_openid = row.get("userOpenid", "")
        try:
            answers = json.loads(row.get("answers", ""))
        except json.JSONDecodeError as exc:
            raise ValueError(f"结果数据第 {row_num} 行 answers 不是合法 JSON。") from exc

        for q_idx_str, answer_indexes in answers.items():
            q = int(q_idx_str) + 1
            try:
                comb = "".join(idx_to_char[int(x)] for x in answer_indexes)
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError(f"结果数据第 {row_num} 行第 {q} 题答案格式异常：{answer_indexes}") from exc
            parsed.append(
                {
                    "participantName": participant,
                    "userOpenid": user_openid,
                    "questionIndex": q,
                    "chosen_comb": comb,
                    "S_final": score_of(score_dict, q, comb) or 0,
                }
            )
    return parsed


def infer_log_question_base(log_rows):
    raw_qs = []
    for row in log_rows:
        q = parse_int(row.get("questionIndex"))
        if q is not None and q != -1:
            raw_qs.append(q)
    raw_set = set(raw_qs)
    if not raw_set:
        return 1, "未在日志中发现有效questionIndex，默认按1-10处理"
    if 0 in raw_set:
        return 0, "日志questionIndex包含0，已按0-9处理并转换为1-10"
    if 10 in raw_set:
        return 1, "日志questionIndex包含10，已按1-10处理"
    return 1, "日志questionIndex只出现1-9，无法完全判断基准；默认按1-10处理，如发现错位请用 --log-question-base 0"


def group_log_events(log_rows, log_question_base="auto"):
    if str(log_question_base) == "auto":
        base, note = infer_log_question_base(log_rows)
    else:
        base = int(log_question_base)
        if base not in {0, 1}:
            raise ValueError("--log-question-base 只能是 auto、0 或 1。")
        note = f"用户手动指定日志questionIndex按{'0-9' if base == 0 else '1-10'}处理"

    grouped = defaultdict(list)
    for row in log_rows:
        user = row.get("userOpenid", "")
        raw_q = parse_int(row.get("questionIndex"))
        t = parse_float(row.get("timestamp"))
        if raw_q is None or raw_q == -1 or t is None:
            continue
        q = raw_q + 1 if base == 0 else raw_q
        if q < 1 or q > 10:
            continue
        event = dict(row)
        event["_timestamp"] = t
        event["_raw_questionIndex"] = raw_q
        event["_questionIndex"] = q
        grouped[(user, q)].append(event)
    for key in grouped:
        grouped[key].sort(key=lambda e: e["_timestamp"])
    return grouped, base, note


def build_trajectory(events, final_comb):
    trajectory = []
    moved_options = []
    transitions = []
    drag_events = [e for e in events if e.get("action") == "change_sorting_option"]
    for event in drag_events:
        previous_comb = clean_sort_value(event.get("previousValue"))
        current_comb = clean_sort_value(event.get("currentValue"))
        moved = clean_sort_value(event.get("answer"))
        if moved and len(moved) == 1:
            moved_options.append(moved)
        elif event.get("answer"):
            answer_text = str(event.get("answer")).strip().upper()
            if answer_text in {"A", "B", "C", "D"}:
                moved_options.append(answer_text)
        if previous_comb and not trajectory:
            trajectory.append(previous_comb)
        if current_comb:
            if not trajectory or trajectory[-1] != current_comb:
                if trajectory:
                    transitions.append((trajectory[-1], current_comb))
                trajectory.append(current_comb)
    if final_comb and (not trajectory or trajectory[-1] != final_comb):
        if trajectory:
            transitions.append((trajectory[-1], final_comb))
        trajectory.append(final_comb)
    if not trajectory and final_comb:
        trajectory = [final_comb]
    return trajectory, moved_options, transitions


def count_top_bottom_changes(trajectory):
    top_change = 0
    bottom_change = 0
    for prev, cur in zip(trajectory, trajectory[1:]):
        if prev and cur and prev[0] != cur[0]:
            top_change += 1
        if prev and cur and prev[-1] != cur[-1]:
            bottom_change += 1
    return top_change, bottom_change


def round6(value):
    if value is None:
        return ""
    if isinstance(value, float):
        if math.isnan(value):
            return ""
        return round(value, 6)
    return value


def write_csv(path, rows, fieldnames):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: round6(v) for k, v in row.items()})


def col_letter(index):
    letters = ""
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def clean_sheet_name(name, used):
    name = re.sub(r"[\[\]\*:/\\?]", "_", str(name))[:31] or "Sheet"
    base = name
    i = 2
    while name in used:
        suffix = f"_{i}"
        name = (base[: 31 - len(suffix)] + suffix) if len(base) + len(suffix) > 31 else base + suffix
        i += 1
    used.add(name)
    return name


def xlsx_cell(value, row_idx, col_idx):
    ref = f"{col_letter(col_idx)}{row_idx}"
    if value is None:
        value = ""
    value = round6(value)
    text = str(value)
    if text == "":
        return f'<c r="{ref}" t="inlineStr"><is><t></t></is></c>'
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(text)}</t></is></c>'


def rows_to_sheet_xml(rows):
    xml_rows = []
    max_cols = max((len(row) for row in rows), default=1)
    dimension = f"A1:{col_letter(max_cols)}{max(len(rows), 1)}"
    for r_idx, values in enumerate(rows, start=1):
        cells = "".join(xlsx_cell(value, r_idx, c_idx) for c_idx, value in enumerate(values, start=1))
        xml_rows.append(f'<row r="{r_idx}">{cells}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<dimension ref="{dimension}"/>'
        '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
        '<sheetFormatPr defaultRowHeight="15"/>'
        f'<sheetData>{"".join(xml_rows)}</sheetData>'
        '</worksheet>'
    )


def dict_rows_to_values(rows, fieldnames):
    values = [fieldnames]
    for row in rows:
        values.append([row.get(field, "") for field in fieldnames])
    return values


def write_xlsx(path, sheets):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    used = set()
    prepared = []
    for sheet_name, rows in sheets:
        prepared.append((clean_sheet_name(sheet_name, used), rows))

    workbook_sheets = []
    rels = []
    overrides = []
    for idx, (sheet_name, _) in enumerate(prepared, start=1):
        workbook_sheets.append(
            f'<sheet name="{escape(sheet_name)}" sheetId="{idx}" r:id="rId{idx}"/>'
        )
        rels.append(
            f'<Relationship Id="rId{idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{idx}.xml"/>'
        )
        overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )

    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets>{"".join(workbook_sheets)}</sheets>'
        '</workbook>'
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(rels)
        + '</Relationships>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + "".join(overrides)
        + '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>'
    )

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("xl/workbook.xml", workbook_xml)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        for idx, (_, rows) in enumerate(prepared, start=1):
            zf.writestr(f"xl/worksheets/sheet{idx}.xml", rows_to_sheet_xml(rows))


def timestamp_seconds(value):
    t = parse_float(value)
    if t is None:
        return None
    # 平台日志通常是毫秒级时间戳。若数值极大，转为秒。
    return t / 1000.0 if t > 1e10 else t


def percentile_rank(value, values):
    values = [v for v in values if v is not None and not math.isnan(v)]
    if value is None or not values:
        return 50.0
    if len(values) == 1:
        return 50.0
    less = sum(1 for v in values if v < value)
    equal = sum(1 for v in values if v == value)
    return 100.0 * (less + 0.5 * equal) / len(values)


def minmax_norm(value, values):
    values = [v for v in values if v is not None and not math.isnan(v)]
    if value is None or not values:
        return 50.0
    lo, hi = min(values), max(values)
    if hi == lo:
        return 50.0
    return 100.0 * (value - lo) / (hi - lo)


def sample_std(values):
    values = [v for v in values if v is not None and not (isinstance(v, float) and math.isnan(v))]
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(variance)


def safe_log_seconds(value):
    if value is None:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(value):
        return None
    return math.log(max(0.001, value))


def clip01(value):
    if value is None:
        return 0.0
    return max(0.0, min(1.0, float(value)))


def classify_teacher(mean_score):
    if mean_score >= HIGH_MEAN_THRESHOLD:
        return "总体偏高"
    if mean_score < LOW_MEAN_THRESHOLD:
        return "总体偏低"
    return "总体中等"


def deviation_strength(abs_rd):
    if abs_rd >= 1.5:
        return "强偏离"
    if abs_rd >= 1.0:
        return "中等偏离"
    if abs_rd >= 0.5:
        return "弱偏离"
    return "偏离不明显"


def calc_idle_correction(events):
    times = [timestamp_seconds(e.get("timestamp")) for e in events]
    times = [t for t in times if t is not None]
    if len(times) < 2:
        return [], 0.0, 0.0, 0
    gaps = [max(0.0, b - a) for a, b in zip(times, times[1:])]
    max_gap = max(gaps) if gaps else 0.0
    removed = sum(max(0.0, g - IDLE_THRESHOLD_SECONDS) for g in gaps)
    flag = int(max_gap >= IDLE_THRESHOLD_SECONDS)
    return gaps, max_gap, removed, flag


def correction_between(events, start_time, end_time):
    if start_time is None or end_time is None or end_time <= start_time:
        return 0.0
    times = [timestamp_seconds(e.get("timestamp")) for e in events]
    times = [t for t in times if t is not None and start_time <= t <= end_time]
    if len(times) < 2:
        return 0.0
    gaps = [max(0.0, b - a) for a, b in zip(times, times[1:])]
    return sum(max(0.0, g - IDLE_THRESHOLD_SECONDS) for g in gaps)


def top_bottom_swap_count(transitions):
    count = 0
    for prev, cur in transitions:
        if not prev or not cur:
            continue
        if prev[0] == cur[-1] or prev[-1] == cur[0]:
            count += 1
    return count


def state_counts(trajectory):
    counts = Counter(trajectory)
    repeated = sum(max(0, c - 1) for c in counts.values())
    seen = set()
    backtracking = 0
    for state in trajectory:
        if state in seen:
            backtracking += 1
        seen.add(state)
    oscillation = 0
    for a, b, c in zip(trajectory, trajectory[1:], trajectory[2:]):
        if a == c and a != b:
            oscillation += 1
    return len(counts), repeated, backtracking, oscillation


def extract_process_features(results, log_events):
    rows = []
    for result in results:
        user = result["userOpenid"]
        q = result["questionIndex"]
        events = log_events.get((user, q), [])
        enter_times = [timestamp_seconds(e.get("timestamp")) for e in events if e.get("action") == "enter_question"]
        leave_times = [timestamp_seconds(e.get("timestamp")) for e in events if e.get("action") == "leave_question"]
        drag_events = [e for e in events if e.get("action") == "change_sorting_option"]
        drag_times = [timestamp_seconds(e.get("timestamp")) for e in drag_events]

        t_enter = enter_times[0] if enter_times else (timestamp_seconds(events[0].get("timestamp")) if events else None)
        t_leave = leave_times[-1] if leave_times else (timestamp_seconds(events[-1].get("timestamp")) if events else None)
        t_first_drag = drag_times[0] if drag_times else None

        raw_total = (t_leave - t_enter) if t_enter is not None and t_leave is not None else None
        raw_first = (t_first_drag - t_enter) if t_enter is not None and t_first_drag is not None else None
        raw_post = (t_leave - t_first_drag) if t_leave is not None and t_first_drag is not None else None

        _, max_gap, removed_total, interruption_flag = calc_idle_correction(events)
        removed_first = correction_between(events, t_enter, t_first_drag)
        removed_post = correction_between(events, t_first_drag, t_leave)

        eff_total = max(0.0, raw_total - removed_total) if raw_total is not None else None
        eff_first = max(0.0, raw_first - removed_first) if raw_first is not None else None
        eff_post = max(0.0, raw_post - removed_post) if raw_post is not None else None

        trajectory, moved_options, transitions = build_trajectory(events, result.get("chosen_comb", ""))
        top_change, bottom_change = count_top_bottom_changes(trajectory)
        top_bottom_swaps = top_bottom_swap_count(transitions)
        unique_states, repeated_states, backtracking, oscillation = state_counts(trajectory)
        priority_option, priority_pair = option_focus_from_trajectory(q, trajectory, moved_options, transitions)

        action_count = len(drag_events)
        revision_count = max(0, len(trajectory) - 1)
        meta = item_meta(q)
        rows.append(
            {
                "participantName": result.get("participantName", ""),
                "userOpenid": user,
                "questionIndex": q,
                "item_id": meta["item_id"],
                "item_title": meta["item_title"],
                **meta_output_fields(meta),
                "raw_item_time_sec": raw_total,
                "effective_item_time_sec": eff_total,
                "effective_first_response_time_sec": eff_first,
                "effective_post_first_time_sec": eff_post,
                "revision_count": revision_count,
                "action_count": action_count,
                "first_position_change_count": top_change,
                "last_position_change_count": bottom_change,
                "top_bottom_swap_count": top_bottom_swaps,
                "unique_state_count": unique_states,
                "repeated_state_count": repeated_states,
                "backtracking_count": backtracking,
                "oscillation_count": oscillation,
                "priorityOption": priority_option,
                "priorityPair": priority_pair,
                "priorityOptionText": option_text(q, priority_option),
                "priorityPairText": pair_text(q, priority_pair),
                "max_idle_gap_sec": max_gap,
                "time_removed_sec": removed_total,
                "interruption_flag": interruption_flag,
            }
        )
    return rows


def add_p_scores(process_rows):
    by_q = defaultdict(list)
    for row in process_rows:
        by_q[row["questionIndex"]].append(row)

    for q, rows in by_q.items():
        vals = {
            "first": [r["effective_first_response_time_sec"] for r in rows],
            "post": [r["effective_post_first_time_sec"] for r in rows],
            "revision": [r["revision_count"] for r in rows],
            "action": [r["action_count"] for r in rows],
            "unique": [r["unique_state_count"] for r in rows],
            "repeat": [r["repeated_state_count"] for r in rows],
            "back": [r["backtracking_count"] for r in rows],
            "osc": [r["oscillation_count"] for r in rows],
        }
        for row in rows:
            p_first = percentile_rank(row["effective_first_response_time_sec"], vals["first"])
            p_post = percentile_rank(row["effective_post_first_time_sec"], vals["post"])
            p_revision = percentile_rank(row["revision_count"], vals["revision"])
            p_action = percentile_rank(row["action_count"], vals["action"])
            p_unique = percentile_rank(row["unique_state_count"], vals["unique"])
            p_repeat = percentile_rank(row["repeated_state_count"], vals["repeat"])
            p_back = percentile_rank(row["backtracking_count"], vals["back"])
            p_osc = percentile_rank(row["oscillation_count"], vals["osc"])

            f_score = 2.0 * abs(p_first - 50.0)
            m_score = 0.40 * p_post + 0.35 * p_revision + 0.25 * p_action
            b_score = min(
                100.0,
                30.0 * int(row["first_position_change_count"] >= 1)
                + 20.0 * int(row["first_position_change_count"] >= 2)
                + 30.0 * int(row["last_position_change_count"] >= 1)
                + 20.0 * int(row["last_position_change_count"] >= 2)
                + 30.0 * int(row["top_bottom_swap_count"] >= 1),
            )
            o_score = 0.20 * p_unique + 0.25 * p_repeat + 0.25 * p_back + 0.30 * p_osc
            p_ivi = 0.20 * f_score + 0.30 * m_score + 0.35 * b_score + 0.15 * o_score

            row["F_score"] = f_score
            row["M_score"] = m_score
            row["B_score"] = b_score
            row["O_score"] = o_score
            row["P_IVI"] = p_ivi

            mainly_time = (
                row["interruption_flag"] == 1
                and b_score == 0
                and row["revision_count"] <= 1
                and row["backtracking_count"] == 0
                and f_score >= max(m_score, b_score, o_score)
            )
            row["selection_status"] = "delay_or_exclude" if mainly_time else "eligible"

    by_user = defaultdict(list)
    for row in process_rows:
        by_user[row["userOpenid"]].append(row)
    for rows in by_user.values():
        sorted_p = sorted(rows, key=lambda r: r["P_IVI"], reverse=True)
        top3 = {r["questionIndex"] for r in sorted_p[:3]}
        bottom3 = {r["questionIndex"] for r in sorted_p[-3:]}
        for row in rows:
            if row["questionIndex"] in top3 or row["P_IVI"] >= 70:
                row["process_type"] = "过程复杂"
            elif row["questionIndex"] in bottom3 or row["P_IVI"] <= 30:
                row["process_type"] = "过程简单"
            else:
                row["process_type"] = "过程中等"
            labels, focus = process_labels(row)
            row["process_labels"] = "；".join(labels)
            row["suggested_interview_focus"] = "；".join(focus)
    return process_rows


def build_iiv_detail(results, p_detail, log_events, score_dict):
    p_by_key = {(r["userOpenid"], r["questionIndex"]): r for r in p_detail}
    detail_rows = []

    for result in results:
        user = result["userOpenid"]
        q = result["questionIndex"]
        process = p_by_key.get((user, q), {})
        events = log_events.get((user, q), [])
        trajectory, _, _ = build_trajectory(events, result.get("chosen_comb", ""))
        scores = [score_of(score_dict, q, comb) for comb in trajectory]
        scores = [s for s in scores if s is not None]

        s_final = result.get("S_final", 0)
        s_initial = scores[0] if scores else s_final
        s_max = max(scores + [s_final]) if scores else s_final
        s_min = min(scores + [s_final]) if scores else s_final

        gain = s_final - s_initial
        volatility = (s_max - s_min) / 4.0
        deterioration = max(0.0, (s_max - s_final) / 4.0)
        recovery = max(0.0, (s_final - s_min) / 4.0)
        revision_signal = max(deterioration, recovery)

        action_count = process.get("action_count", 0) or 0
        operation_complexity = 0.0 if action_count <= 1 else 1.0 - (1.0 / action_count)
        top_change = process.get("first_position_change_count", 0) or 0
        bottom_change = process.get("last_position_change_count", 0) or 0
        option_focus = min(1.0, (top_change + bottom_change) / 4.0)
        process_conflict = max(operation_complexity, volatility)

        result_risk = (4.0 - s_final) / 4.0
        relative_deviation = abs(result.get("RD", 0.0)) / 4.0
        p_ivi = process.get("P_IVI", 0.0) or 0.0
        p_ivi_norm = clip01(p_ivi / 100.0)

        meta = item_meta(q)
        detail_rows.append(
            {
                "participantName": result.get("participantName", ""),
                "userOpenid": user,
                "teacher_level": result.get("teacher_level", ""),
                "mean_score": result.get("mean_score", ""),
                "total_score": result.get("total_score", ""),
                "item_id": meta["item_id"],
                "questionIndex": q,
                "item_title": meta["item_title"],
                **meta_output_fields(meta),
                "primary_ability_type": meta.get("primary", ""),
                "secondary_ability_type": meta.get("secondary", ""),
                "chosen_comb": result.get("chosen_comb", ""),
                "S_initial": s_initial,
                "S_final": s_final,
                "S_max": s_max,
                "S_min": s_min,
                "ResultRisk": result_risk,
                "RelativeDeviation": relative_deviation,
                "RD": result.get("RD", 0.0),
                "abs_RD": result.get("abs_RD", 0.0),
                "Gain": gain,
                "Volatility": volatility,
                "Deterioration": deterioration,
                "Recovery": recovery,
                "RevisionSignal": revision_signal,
                "ProcessConflict": process_conflict,
                "OptionFocus": option_focus,
                "P_IVI": p_ivi,
                "P_IVI_norm": p_ivi_norm,
                "effective_first_response_time_sec": process.get("effective_first_response_time_sec"),
                "effective_post_first_time_sec": process.get("effective_post_first_time_sec"),
                "effective_item_time_sec": process.get("effective_item_time_sec"),
                "ln_first": safe_log_seconds(process.get("effective_first_response_time_sec")),
                "ln_post": safe_log_seconds(process.get("effective_post_first_time_sec")),
                "action_count": action_count,
                "revision_count": process.get("revision_count", 0),
                "first_position_change_count": top_change,
                "last_position_change_count": bottom_change,
                "top_bottom_swap_count": process.get("top_bottom_swap_count", 0),
                "unique_state_count": process.get("unique_state_count", 0),
                "repeated_state_count": process.get("repeated_state_count", 0),
                "backtracking_count": process.get("backtracking_count", 0),
                "oscillation_count": process.get("oscillation_count", 0),
                "max_idle_gap_sec": process.get("max_idle_gap_sec", 0),
                "time_removed_sec": process.get("time_removed_sec", 0),
                "interruption_flag": process.get("interruption_flag", 0),
                "priorityOption": process.get("priorityOption", ""),
                "priorityPair": process.get("priorityPair", ""),
                "priorityOptionText": process.get("priorityOptionText", ""),
                "priorityPairText": process.get("priorityPairText", ""),
                "process_type": process.get("process_type", "过程中等"),
                "process_labels": process.get("process_labels", ""),
                "suggested_interview_focus": process.get("suggested_interview_focus", ""),
            }
        )

    by_user_first = defaultdict(list)
    by_user_post = defaultdict(list)
    for row in detail_rows:
        if row.get("ln_first") is not None:
            by_user_first[row["userOpenid"]].append(row["ln_first"])
        if row.get("ln_post") is not None:
            by_user_post[row["userOpenid"]].append(row["ln_post"])

    stats = {}
    for user in {r["userOpenid"] for r in detail_rows}:
        first_values = by_user_first.get(user, [])
        post_values = by_user_post.get(user, [])
        stats[user] = {
            "first_mean": sum(first_values) / len(first_values) if first_values else None,
            "first_std": sample_std(first_values),
            "post_mean": sum(post_values) / len(post_values) if post_values else None,
            "post_std": sample_std(post_values),
        }

    for row in detail_rows:
        st = stats[row["userOpenid"]]
        if row.get("ln_first") is not None and st["first_mean"] is not None and st["first_std"] > 0:
            z_first = (row["ln_first"] - st["first_mean"]) / st["first_std"]
        else:
            z_first = 0.0
        if row.get("ln_post") is not None and st["post_mean"] is not None and st["post_std"] > 0:
            z_post = (row["ln_post"] - st["post_mean"]) / st["post_std"]
        else:
            z_post = 0.0

        time_raw_z = max(0.0, z_first, z_post)
        time_signal = min(1.0, time_raw_z / 2.0)
        iiv_classic = (
            0.40 * row["ResultRisk"]
            + 0.20 * row["ProcessConflict"]
            + 0.20 * row["RevisionSignal"]
            + 0.10 * time_signal
            + 0.10 * row["OptionFocus"]
        )
        iiv_hybrid = (
            0.30 * row["ResultRisk"]
            + 0.15 * row["RelativeDeviation"]
            + 0.15 * row["ProcessConflict"]
            + 0.15 * row["RevisionSignal"]
            + 0.10 * time_signal
            + 0.10 * row["OptionFocus"]
            + 0.05 * row["P_IVI_norm"]
        )

        row["Z_First"] = z_first
        row["Z_Post"] = z_post
        row["TimeSignal_raw_z"] = time_raw_z
        row["TimeSignal"] = time_signal
        row["IIV_classic"] = iiv_classic
        row["IIV_hybrid"] = iiv_hybrid
        row["IIV_interpretation"] = iiv_interpretation(row)

    return detail_rows


def iiv_interpretation(row):
    parts = []
    components = [
        ("结果风险", row.get("ResultRisk", 0)),
        ("个人内相对偏离", row.get("RelativeDeviation", 0)),
        ("过程冲突", row.get("ProcessConflict", 0)),
        ("修正信号", row.get("RevisionSignal", 0)),
        ("相对时间信号", row.get("TimeSignal", 0)),
        ("选项焦点变化", row.get("OptionFocus", 0)),
        ("同题过程信息量", row.get("P_IVI_norm", 0)),
    ]
    top_components = [name for name, value in sorted(components, key=lambda x: x[1], reverse=True)[:3] if value > 0]
    if top_components:
        parts.append("主要IIV信号：" + "、".join(top_components))
    if row.get("priorityPair"):
        parts.append("可追问选项比较：" + pair_text(row.get("questionIndex"), row.get("priorityPair")))
    elif row.get("priorityOption"):
        parts.append("可追问重点选项：" + option_text(row.get("questionIndex"), row.get("priorityOption")))
    return "；".join(parts) if parts else "IIV信号不突出，可作为备用参考"


def process_labels(row):
    labels = []
    focus = []
    first_values = (row.get("effective_first_response_time_sec"),)
    if row["F_score"] >= 60:
        median_hint = "首反应异常"
        labels.append(median_hint)
        focus.append("请教师回忆读到情境后最先注意到什么、是否很快形成判断或感到难判断")
    if row["M_score"] >= 60:
        labels.append("高修正投入")
        focus.append("追问后续主要在比较哪些做法、为什么调整")
    if row["revision_count"] >= 3:
        labels.append("多次调整")
    if row["B_score"] >= 50:
        labels.append("首末位摇摆")
        focus.append("追问最理想或最不理想做法的判断为什么发生变化")
    if row["top_bottom_swap_count"] > 0:
        labels.append("优劣方向冲突")
        focus.append("追问是否曾把某做法从合适改判为不合适，或相反")
    if row["O_score"] >= 60:
        labels.append("路径振荡")
        focus.append("追问当时是否在几个判断标准之间反复权衡")
    if row["interruption_flag"]:
        labels.append("疑似外部中断")
        focus.append("若访谈涉及此题，需先确认中途停顿是否来自外部干扰")
    if not labels:
        labels.append("过程相对平稳")
        focus.append("追问教师当时主要依据什么形成排序")
    return labels, focus


def select_p_candidates(process_rows):
    selected = []
    by_user = defaultdict(list)
    for row in process_rows:
        by_user[row["userOpenid"]].append(row)
    for user, rows in by_user.items():
        sorted_rows = sorted(
            rows,
            key=lambda r: (
                r["selection_status"] == "eligible",
                r["P_IVI"],
                r["B_score"],
                r["M_score"],
                r["O_score"],
                r["F_score"],
                -r["interruption_flag"],
            ),
            reverse=True,
        )
        rank = 1
        for row in sorted_rows:
            if row["selection_status"] != "eligible" and len([r for r in selected if r["userOpenid"] == user]) < 2:
                # 只有在没有足够合格题时才使用疑似外部中断题。
                pass
            out = dict(row)
            out["candidate_rank"] = rank
            out["main_process_trigger"] = main_process_trigger(row)
            out["time_correction_note"] = (
                f"疑似中断，剔除{round(row['time_removed_sec'], 2)}秒超长无操作时间"
                if row["time_removed_sec"] else "未进行时间剔除"
            )
            selected.append(out)
            rank += 1
            if rank > 2:
                break
    return selected


def main_process_trigger(row):
    scores = {
        "首反应异常": row["F_score"],
        "修正投入": row["M_score"],
        "首末位摇摆": row["B_score"],
        "路径振荡": row["O_score"],
    }
    return max(scores.items(), key=lambda kv: kv[1])[0]


def add_result_context(results):
    by_user = defaultdict(list)
    for row in results:
        by_user[row["userOpenid"]].append(row)
    for rows in by_user.values():
        mean_score = sum(r["S_final"] for r in rows) / len(rows)
        total_score = sum(r["S_final"] for r in rows)
        level = classify_teacher(mean_score)
        for row in rows:
            row["mean_score"] = mean_score
            row["total_score"] = total_score
            row["RD"] = row["S_final"] - mean_score
            row["abs_RD"] = abs(row["RD"])
            row["teacher_level"] = level
    return results


def select_r_candidates(results, p_by_key):
    selected = []
    by_user = defaultdict(list)
    for row in results:
        by_user[row["userOpenid"]].append(row)

    for user, rows in by_user.items():
        level = rows[0]["teacher_level"]
        if level == "总体偏高":
            ordered = sorted(rows, key=lambda r: (r["RD"], -p_by_key.get((user, r["questionIndex"]), {}).get("P_IVI", 0), r["questionIndex"]))
            picks = ordered[:2]
            types = ["最负偏离题", "最负偏离题"]
            orientation = "局部短板解释"
            reason = "总体偏高教师中低于个人平均最多"
        elif level == "总体偏低":
            ordered = sorted(rows, key=lambda r: (r["RD"], p_by_key.get((user, r["questionIndex"]), {}).get("P_IVI", 0), -r["questionIndex"]), reverse=True)
            picks = ordered[:2]
            types = ["最正偏离题", "最正偏离题"]
            orientation = "相对优势和可激活能力解释"
            reason = "总体偏低教师中高于个人平均最多"
        else:
            pos = max(rows, key=lambda r: (r["RD"], p_by_key.get((user, r["questionIndex"]), {}).get("P_IVI", 0)))
            neg = min(rows, key=lambda r: (r["RD"], -p_by_key.get((user, r["questionIndex"]), {}).get("P_IVI", 0)))
            picks = [pos, neg] if pos["questionIndex"] != neg["questionIndex"] else sorted(rows, key=lambda r: r["abs_RD"], reverse=True)[:2]
            types = ["最正偏离题", "最负偏离题"]
            orientation = "能力分化画像"
            reason = "总体中等教师中一正一负偏离端点"
        for rank, (row, ctype) in enumerate(zip(picks, types), start=1):
            meta = item_meta(row["questionIndex"])
            selected.append(
                {
                    "participantName": row.get("participantName", ""),
                    "userOpenid": user,
                    "teacher_level": level,
                    "mean_score": row["mean_score"],
                    "candidate_rank": rank,
                    "item_id": meta["item_id"],
                    "questionIndex": row["questionIndex"],
                    "item_title": meta["item_title"],
                    **meta_output_fields(meta),
                    "item_score": row["S_final"],
                    "RD": row["RD"],
                    "abs_RD": row["abs_RD"],
                    "candidate_type": ctype,
                    "deviation_strength": deviation_strength(row["abs_RD"]),
                    "selection_reason": reason,
                    "tie_break_reason": "并列时优先参考P-IVI、再按题号",
                    "interview_orientation": orientation,
                }
            )
    return selected


def rank_score_by_direction(rows, direction):
    if direction == "low":
        ordered = sorted(rows, key=lambda r: (r["RD"], r["questionIndex"]))
    else:
        ordered = sorted(rows, key=lambda r: (r["RD"], -r["questionIndex"]), reverse=True)
    scores = [60, 50, 40, 30]
    return {r["questionIndex"]: (scores[i] if i < len(scores) else 20) for i, r in enumerate(ordered)}


def select_g_candidates(results, p_by_key):
    selected = []
    g_all_scores = {}
    by_user = defaultdict(list)
    for row in results:
        by_user[row["userOpenid"]].append(row)

    for user, rows in by_user.items():
        level = rows[0]["teacher_level"]
        pivi = {r["questionIndex"]: p_by_key.get((user, r["questionIndex"]), {}).get("P_IVI", 0.0) for r in rows}
        ptype = {r["questionIndex"]: p_by_key.get((user, r["questionIndex"]), {}).get("process_type", "过程中等") for r in rows}
        picks = []
        if level == "总体偏高":
            low_rows = [r for r in rows if r["RD"] < 0] or sorted(rows, key=lambda r: r["RD"])[:2]
            low_rank = rank_score_by_direction(low_rows, "low")
            for r in rows:
                base_rank = low_rank.get(r["questionIndex"], 20)
                g_all_scores[(user, r["questionIndex"])] = max(base_rank + 0.4 * pivi[r["questionIndex"]], base_rank + 0.4 * (100 - pivi[r["questionIndex"]]))
            complex_pick = max(low_rows, key=lambda r: (low_rank.get(r["questionIndex"], 20) + 0.4 * pivi[r["questionIndex"]], -r["RD"]))
            remaining = [r for r in low_rows if r["questionIndex"] != complex_pick["questionIndex"]] or [r for r in rows if r["questionIndex"] != complex_pick["questionIndex"]]
            simple_pick = max(remaining, key=lambda r: (low_rank.get(r["questionIndex"], 20) + 0.4 * (100 - pivi[r["questionIndex"]]), -abs(r["RD"])))
            picks = [
                (complex_pick, "结果低 + 过程复杂", low_rank.get(complex_pick["questionIndex"], 20) + 0.4 * pivi[complex_pick["questionIndex"]]),
                (simple_pick, "结果低 + 过程简单", low_rank.get(simple_pick["questionIndex"], 20) + 0.4 * (100 - pivi[simple_pick["questionIndex"]])),
            ]
        elif level == "总体偏低":
            high_rows = [r for r in rows if r["RD"] > 0] or sorted(rows, key=lambda r: r["RD"], reverse=True)[:2]
            high_rank = rank_score_by_direction(high_rows, "high")
            for r in rows:
                base_rank = high_rank.get(r["questionIndex"], 20)
                g_all_scores[(user, r["questionIndex"])] = max(base_rank + 0.4 * pivi[r["questionIndex"]], base_rank + 0.4 * (100 - pivi[r["questionIndex"]]))
            complex_pick = max(high_rows, key=lambda r: (high_rank.get(r["questionIndex"], 20) + 0.4 * pivi[r["questionIndex"]], r["RD"]))
            remaining = [r for r in high_rows if r["questionIndex"] != complex_pick["questionIndex"]] or [r for r in rows if r["questionIndex"] != complex_pick["questionIndex"]]
            simple_pick = max(remaining, key=lambda r: (high_rank.get(r["questionIndex"], 20) + 0.4 * (100 - pivi[r["questionIndex"]]), abs(r["RD"])))
            picks = [
                (complex_pick, "结果高 + 过程复杂", high_rank.get(complex_pick["questionIndex"], 20) + 0.4 * pivi[complex_pick["questionIndex"]]),
                (simple_pick, "结果高 + 过程简单", high_rank.get(simple_pick["questionIndex"], 20) + 0.4 * (100 - pivi[simple_pick["questionIndex"]])),
            ]
        else:
            for r in rows:
                g_all_scores[(user, r["questionIndex"])] = minmax_norm(r["abs_RD"], [x["abs_RD"] for x in rows]) * 0.6 + 0.4 * pivi[r["questionIndex"]]
            high = max(rows, key=lambda r: (r["RD"], pivi[r["questionIndex"]]))
            low = min(rows, key=lambda r: (r["RD"], -pivi[r["questionIndex"]]))
            if high["questionIndex"] == low["questionIndex"]:
                top2 = sorted(rows, key=lambda r: pivi[r["questionIndex"]], reverse=True)[:2]
                picks = [(top2[0], "P分替补：过程最高题", pivi[top2[0]["questionIndex"]]), (top2[1], "P分替补：过程第二高题", pivi[top2[1]["questionIndex"]])]
            else:
                picks = [(high, "最高结果端", high["abs_RD"] * 100), (low, "最低结果端", low["abs_RD"] * 100)]

        for rank, (row, relation, gscore) in enumerate(picks, start=1):
            meta = item_meta(row["questionIndex"])
            selected.append(
                {
                    "participantName": row.get("participantName", ""),
                    "userOpenid": user,
                    "teacher_level": level,
                    "candidate_rank": rank,
                    "item_id": meta["item_id"],
                    "questionIndex": row["questionIndex"],
                    "item_title": meta["item_title"],
                    **meta_output_fields(meta),
                    "item_score": row["S_final"],
                    "mean_score": row["mean_score"],
                    "RD": row["RD"],
                    "P_IVI": pivi[row["questionIndex"]],
                    "process_type": ptype[row["questionIndex"]],
                    "relation_type": relation,
                    "G_candidate_score": gscore,
                    "selection_reason": g_selection_reason(level, relation),
                    "interview_focus": g_interview_focus(level, relation),
                }
            )
    return selected, g_all_scores


def g_selection_reason(level, relation):
    if level == "总体偏高":
        return "总体偏高教师优先解释相对低点，并区分过程复杂和平稳低点"
    if level == "总体偏低":
        return "总体偏低教师优先解释相对高点，并区分过程复杂和平稳高点"
    return "总体中等教师优先解释结果偏离两端形成的能力分化"


def g_interview_focus(level, relation):
    mapping = {
        "结果低 + 过程复杂": "解释为什么投入较多比较和修正后仍形成相对低结果，关注专业标准冲突或误区",
        "结果低 + 过程简单": "解释为什么快速稳定形成相对低判断，关注经验惯性、隐性盲点或直觉偏差",
        "结果高 + 过程复杂": "解释如何通过比较、修正或重新权衡形成相对较好判断，关注可激活能力",
        "结果高 + 过程简单": "解释为什么能快速稳定形成较好判断，关注已有经验或优势图式",
        "最高结果端": "解释相对优势端如何形成",
        "最低结果端": "解释相对薄弱端如何形成",
    }
    return mapping.get(relation, "解释该题的结果与过程关系")


def build_final_selection(results, r_selected, p_selected, g_selected, p_by_key, g_all_scores, iiv_by_key=None):
    iiv_by_key = iiv_by_key or {}
    by_user_results = defaultdict(list)
    for row in results:
        by_user_results[row["userOpenid"]].append(row)

    r_by_user = defaultdict(list)
    p_by_user = defaultdict(list)
    g_by_user = defaultdict(list)
    for r in r_selected:
        r_by_user[r["userOpenid"]].append(r)
    for p in p_selected:
        p_by_user[p["userOpenid"]].append(p)
    for g in g_selected:
        g_by_user[g["userOpenid"]].append(g)

    final_rows = []
    for user, rows in by_user_results.items():
        participant = rows[0].get("participantName", "")
        candidate_pool = {}
        add_source_candidates(candidate_pool, r_by_user[user], "R")
        add_source_candidates(candidate_pool, p_by_user[user], "P")
        add_source_candidates(candidate_pool, g_by_user[user], "G")
        for q, cand in candidate_pool.items():
            cand["FES"] = fes(cand)
            cand["RS"] = reserve_score(user, q, rows, p_by_key, g_all_scores)

        if len(candidate_pool) >= 3:
            chosen = sorted(candidate_pool.values(), key=lambda c: (c["FES"], c["source_count"], c.get("G_rank", 99) != ""), reverse=True)[:3]
            chosen, note = coverage_repair(chosen, candidate_pool.values(), rows)
        else:
            chosen = list(candidate_pool.values())
            needed = 3 - len(chosen)
            used_q = {c["questionIndex"] for c in chosen}
            reserves = []
            for r in rows:
                if r["questionIndex"] in used_q:
                    continue
                meta = item_meta(r["questionIndex"])
                reserves.append(
                    {
                        "participantName": participant,
                        "userOpenid": user,
                        "questionIndex": r["questionIndex"],
                        "item_id": meta["item_id"],
                        "item_title": meta["item_title"],
                        **meta_output_fields(meta),
                        "primary_ability_type": meta["primary"],
                        "secondary_ability_type": meta["secondary"],
                        "sources": [],
                        "source_count": 0,
                        "R_rank": "",
                        "P_rank": "",
                        "G_rank": "",
                        "FES": 0,
                        "RS": reserve_score(user, r["questionIndex"], rows, p_by_key, g_all_scores),
                        "replacement_note": "候选池不足3题，按备用综合分补入",
                    }
                )
            chosen.extend(sorted(reserves, key=lambda c: c["RS"], reverse=True)[:needed])
            chosen, note = coverage_repair(chosen, list(candidate_pool.values()) + reserves, rows)

        chosen = sorted(chosen, key=lambda c: (c["FES"], c["RS"]), reverse=True)[:3]
        for rank, cand in enumerate(chosen, start=1):
            micro = p_by_key.get((user, cand["questionIndex"]), {})
            iiv = iiv_by_key.get((user, cand["questionIndex"]), {})
            priority_option = micro.get("priorityOption", "")
            priority_pair = micro.get("priorityPair", "")
            row_out = {
                "participantName": participant,
                "userOpenid": user,
                "final_rank": rank,
                "final_item_id": cand["item_id"],
                "questionIndex": cand["questionIndex"],
                "item_title": cand["item_title"],
                "scenarioText": cand.get("scenarioText", ""),
                "optionA": cand.get("optionA", ""),
                "optionB": cand.get("optionB", ""),
                "optionC": cand.get("optionC", ""),
                "optionD": cand.get("optionD", ""),
                "primary_ability_type": cand["primary_ability_type"],
                "secondary_ability_type": cand["secondary_ability_type"],
                "source_summary": "/".join(cand.get("sources", [])) or "备用补入",
                "source_count": cand.get("source_count", 0),
                "R_rank": cand.get("R_rank", ""),
                "P_rank": cand.get("P_rank", ""),
                "G_rank": cand.get("G_rank", ""),
                "ResultRisk": iiv.get("ResultRisk", ""),
                "RelativeDeviation": iiv.get("RelativeDeviation", ""),
                "ProcessConflict": iiv.get("ProcessConflict", ""),
                "RevisionSignal": iiv.get("RevisionSignal", ""),
                "TimeSignal": iiv.get("TimeSignal", ""),
                "OptionFocus": iiv.get("OptionFocus", ""),
                "P_IVI_norm": iiv.get("P_IVI_norm", ""),
                "IIV_classic": iiv.get("IIV_classic", ""),
                "IIV_hybrid": iiv.get("IIV_hybrid", ""),
                "FES": cand.get("FES", 0),
                "RS": cand.get("RS", 0),
                "selection_reason": final_reason(cand, iiv),
                "coverage_role": coverage_role(cand),
                "interview_focus": final_focus(cand, r_by_user[user], p_by_user[user], g_by_user[user]),
                "priorityOption": priority_option,
                "priorityPair": priority_pair,
                "priorityOptionText": option_text(cand["questionIndex"], priority_option),
                "priorityPairText": pair_text(cand["questionIndex"], priority_pair),
                "replacement_note": cand.get("replacement_note", note),
                "forbiddenDisclosureReminder": OUTPUT_WARNING,
            }
            row_out["safeInterviewPrompt"] = build_safe_interview_prompt(row_out)
            final_rows.append(
                row_out
            )
    return final_rows


def add_source_candidates(pool, rows, source):
    for row in rows:
        q = row["questionIndex"]
        meta = item_meta(q)
        if q not in pool:
            pool[q] = {
                "participantName": row.get("participantName", ""),
                "userOpenid": row.get("userOpenid", ""),
                "questionIndex": q,
                "item_id": meta["item_id"],
                "item_title": meta["item_title"],
                **meta_output_fields(meta),
                "primary_ability_type": meta["primary"],
                "secondary_ability_type": meta["secondary"],
                "sources": [],
                "R_rank": "",
                "P_rank": "",
                "G_rank": "",
                "replacement_note": "",
            }
        pool[q]["sources"].append(source)
        pool[q][f"{source}_rank"] = row.get("candidate_rank", "")
        pool[q]["source_count"] = len(set(pool[q]["sources"]))


def fes(cand):
    score = 0
    if "R" in cand["sources"]:
        score += 20 + (8 if cand.get("R_rank") == 1 else 4)
    if "P" in cand["sources"]:
        score += 20 + (8 if cand.get("P_rank") == 1 else 4)
    if "G" in cand["sources"]:
        score += 30 + (10 if cand.get("G_rank") == 1 else 5)
    return score


def reserve_score(user, q, rows, p_by_key, g_all_scores):
    r_values = [r["abs_RD"] for r in rows]
    row = next(r for r in rows if r["questionIndex"] == q)
    r_norm = minmax_norm(row["abs_RD"], r_values)
    p_norm = p_by_key.get((user, q), {}).get("P_IVI", 0.0)
    g_values = [g_all_scores.get((user, r["questionIndex"]), 0.0) for r in rows]
    g_norm = minmax_norm(g_all_scores.get((user, q), 0.0), g_values)
    return 0.45 * g_norm + 0.30 * p_norm + 0.25 * r_norm


def coverage_repair(chosen, all_candidates, rows):
    note = ""
    def primary_set(items):
        return {c["primary_ability_type"] for c in items if c["primary_ability_type"]}

    if len(chosen) < 3:
        return chosen, note
    if len(primary_set(chosen)) >= 2 and max(Counter(c["primary_ability_type"] for c in chosen).values()) <= 2:
        return chosen, note

    chosen_q = {c["questionIndex"] for c in chosen}
    repeated_types = Counter(c["primary_ability_type"] for c in chosen)
    replace_candidates = sorted(
        chosen,
        key=lambda c: (repeated_types[c["primary_ability_type"]], -c["FES"]),
        reverse=True,
    )
    current_types = primary_set(chosen)
    alternatives = sorted(
        [c for c in all_candidates if c["questionIndex"] not in chosen_q and c["primary_ability_type"] not in current_types],
        key=lambda c: (c.get("FES", 0), c.get("RS", 0)),
        reverse=True,
    )
    if alternatives:
        to_remove = min(replace_candidates, key=lambda c: (c.get("FES", 0), c.get("RS", 0)))
        chosen = [c for c in chosen if c["questionIndex"] != to_remove["questionIndex"]]
        alt = alternatives[0]
        alt["replacement_note"] = "为避免最终3题能力类型过度集中，按覆盖规则补入"
        chosen.append(alt)
        note = "触发能力覆盖修正"
    return chosen, note


def final_reason(cand, iiv=None):
    iiv = iiv or {}
    iiv_note = ""
    if iiv.get("IIV_interpretation"):
        iiv_note = "；IIV规范化信号：" + iiv["IIV_interpretation"]
    if cand.get("source_count", 0) >= 2:
        return "R/P/G多源证据重复入选，系统解释强度较高" + iiv_note
    if "G" in cand.get("sources", []):
        return "来自G分候选，具有结果-过程关系解释价值" + iiv_note
    if "P" in cand.get("sources", []):
        return "来自P分候选，作答过程具有访谈解释价值" + iiv_note
    if "R" in cand.get("sources", []):
        return "来自R分候选，相对个人整体表现具有结果偏离解释价值" + iiv_note
    return "候选不足时按备用综合分补入" + iiv_note


def coverage_role(cand):
    return f"覆盖能力类型：{cand.get('primary_ability_type', '')}"


def final_focus(cand, r_rows, p_rows, g_rows):
    q = cand["questionIndex"]
    focuses = []
    for g in g_rows:
        if g["questionIndex"] == q:
            focuses.append(g.get("interview_focus", ""))
    for p in p_rows:
        if p["questionIndex"] == q:
            focuses.append(p.get("suggested_interview_focus", ""))
    for r in r_rows:
        if r["questionIndex"] == q:
            focuses.append(r.get("interview_orientation", ""))
    focuses = [f for f in focuses if f]
    return "；".join(focuses) if focuses else "围绕该情境理解、选项比较和判断依据进行访谈"


def build_ai_safe_rows(final_selected):
    rows = []
    for row in final_selected:
        safe_row = {col: row.get(col, "") for col in AI_SAFE_COLUMNS}
        safe_row["forbiddenDisclosureReminder"] = SAFE_OUTPUT_WARNING
        rows.append(safe_row)
    return rows


def method_note_rows(log_base, log_base_note):
    return [
        ["项目", "说明"],
        ["版本定位", "综合优化版：保留导师R/P/G/最终3题框架，同时加入IIV规范化指标作为量化底座。"],
        ["输出结构", "默认只输出两个Excel文件：AI访谈材料.xlsx；研究者筛选材料.xlsx。"],
        ["结果数据题号基准", "结果数据 answers 通常为0-9，程序统一转换为1-10。"],
        ["过程日志题号基准", log_base_note],
        ["过程日志实际处理", "0-9已转换为1-10；1-10保持不变。若发现题号错位，可运行时指定 --log-question-base 0 或 --log-question-base 1。"],
        ["R", "结果性偏离：考察某题相对教师个人整体表现的高点或低点。"],
        ["P", "过程性信息量：基于首反应、修正投入、首末位变化、路径振荡等过程指标计算P-IVI。"],
        ["G", "结果-过程关系：区分结果与过程之间的解释组合。"],
        ["最终3题", "优先考虑R/P/G多源证据、备用综合分和能力类型覆盖。"],
        ["ResultRisk", "(4 - S_final) / 4"],
        ["RelativeDeviation", "abs(S_final - 个人平均分) / 4"],
        ["ProcessConflict", "max(操作复杂度, Volatility)"],
        ["RevisionSignal", "max(Deterioration, Recovery)"],
        ["TimeSignal", "个人内对数时间z值换算，按2个标准差封顶到0-1。"],
        ["OptionFocus", "min(1, 首位变化次数与末位变化次数之和 / 4)"],
        ["P_IVI_norm", "P_IVI / 100"],
        ["IIV_classic", "0.40*ResultRisk + 0.20*ProcessConflict + 0.20*RevisionSignal + 0.10*TimeSignal + 0.10*OptionFocus"],
        ["IIV_hybrid", "0.30*ResultRisk + 0.15*RelativeDeviation + 0.15*ProcessConflict + 0.15*RevisionSignal + 0.10*TimeSignal + 0.10*OptionFocus + 0.05*P_IVI_norm"],
        ["AI材料安全提醒", SAFE_OUTPUT_WARNING],
        ["研究者材料提醒", "研究者筛选材料含内部指标，只用于研究审查，不应直接展示给教师。"],
    ]


def write_output_materials(out_dir, final_selected, iiv_detail, r_selected, p_selected, g_selected, log_base, log_base_note):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ai_rows = build_ai_safe_rows(final_selected)
    write_xlsx(
        out_dir / "AI访谈材料.xlsx",
        [("AI访谈材料", dict_rows_to_values(ai_rows, AI_SAFE_COLUMNS))],
    )
    write_xlsx(
        out_dir / "研究者筛选材料.xlsx",
        [
            ("最终3题", dict_rows_to_values(final_selected, FINAL_COLUMNS)),
            ("10题IIV明细", dict_rows_to_values(
                sorted(iiv_detail, key=lambda r: (r["userOpenid"], r["questionIndex"])),
                IIV_DETAIL_COLUMNS,
            )),
            ("R结果偏离候选", dict_rows_to_values(r_selected, R_COLUMNS)),
            ("P过程候选", dict_rows_to_values(p_selected, P_SELECTED_COLUMNS)),
            ("G结果过程候选", dict_rows_to_values(g_selected, G_COLUMNS)),
            ("方法说明", method_note_rows(log_base, log_base_note)),
        ],
    )


def write_legacy_csv_outputs(out_dir, r_selected, p_detail, p_selected, g_selected, iiv_detail, final_selected):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    write_csv(out_dir / "advisor_R_result_deviation_candidates.csv", r_selected, R_COLUMNS)
    write_csv(out_dir / "advisor_P_process_detail.csv", p_detail, P_DETAIL_COLUMNS)
    write_csv(out_dir / "advisor_P_process_candidates.csv", p_selected, P_SELECTED_COLUMNS)
    write_csv(out_dir / "advisor_G_result_process_candidates.csv", g_selected, G_COLUMNS)
    write_csv(
        out_dir / "comprehensive_iiv_question_detail.csv",
        sorted(iiv_detail, key=lambda r: (r["userOpenid"], -r.get("IIV_hybrid", 0), r["questionIndex"])),
        IIV_DETAIL_COLUMNS,
    )
    write_csv(out_dir / "advisor_final_3_interview_items.csv", final_selected, FINAL_COLUMNS)
    write_csv(out_dir / "advisor_ai_interview_safe_prompts.csv", build_ai_safe_rows(final_selected), AI_SAFE_COLUMNS)


def calculate(results_csv, logs_csv, output_dir, log_question_base="auto", legacy_csv=False):
    score_dict = build_score_dict()
    results_rows = read_csv_dicts(results_csv)
    log_rows = read_csv_dicts(logs_csv)
    validate_columns(results_rows, REQUIRED_RESULTS_COLUMNS, "结果数据")
    validate_columns(log_rows, REQUIRED_LOG_COLUMNS, "过程日志")

    results = parse_results(results_rows, score_dict)
    results = add_result_context(results)
    log_events, log_base, log_base_note = group_log_events(log_rows, log_question_base=log_question_base)

    p_detail = add_p_scores(extract_process_features(results, log_events))
    p_by_key = {(r["userOpenid"], r["questionIndex"]): r for r in p_detail}
    p_selected = select_p_candidates(p_detail)
    r_selected = select_r_candidates(results, p_by_key)
    g_selected, g_all_scores = select_g_candidates(results, p_by_key)
    iiv_detail = build_iiv_detail(results, p_detail, log_events, score_dict)
    iiv_by_key = {(r["userOpenid"], r["questionIndex"]): r for r in iiv_detail}
    final_selected = build_final_selection(
        results, r_selected, p_selected, g_selected, p_by_key, g_all_scores, iiv_by_key
    )

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    write_output_materials(out_dir, final_selected, iiv_detail, r_selected, p_selected, g_selected, log_base, log_base_note)
    if legacy_csv:
        write_legacy_csv_outputs(out_dir / "legacy_csv", r_selected, p_detail, p_selected, g_selected, iiv_detail, final_selected)
    return r_selected, p_selected, g_selected, final_selected, log_base_note


def main():
    parser = argparse.ArgumentParser(description="综合优化版：按R/P/G框架与IIV规范化指标筛选AI访谈候选题。")
    parser.add_argument("results_csv", help="结果数据CSV")
    parser.add_argument("logs_csv", help="过程日志CSV")
    parser.add_argument("-o", "--output-dir", default="advisor_rpg_output", help="输出文件夹")
    parser.add_argument(
        "--log-question-base",
        default="auto",
        choices=["auto", "0", "1"],
        help="过程日志questionIndex基准：auto自动判断；0表示日志为0-9；1表示日志为1-10。默认auto。",
    )
    parser.add_argument(
        "--legacy-csv",
        action="store_true",
        help="额外输出旧版分散CSV到legacy_csv子文件夹。默认只输出两个Excel材料文件。",
    )
    args = parser.parse_args()

    _, _, _, final_selected, log_base_note = calculate(
        args.results_csv,
        args.logs_csv,
        args.output_dir,
        log_question_base=args.log_question_base,
        legacy_csv=args.legacy_csv,
    )
    print(f"计算完成，结果已输出到：{args.output_dir}")
    print(f"日志题号处理：{log_base_note}")
    print("主要输出文件：")
    print("- AI访谈材料.xlsx")
    print("- 研究者筛选材料.xlsx")
    print("最终3题预览：")
    for row in final_selected:
        print(
            f"- {row['participantName']} | 第{row['questionIndex']}题 {row['item_title']} | "
            f"来源：{row['source_summary']} | 能力类型：{row['primary_ability_type']}"
        )
    print("\n重要提醒：AI访谈材料不含内部计算指标；访谈时不得向教师透露任何得分、排名、入选原因或评价性判断。")


if __name__ == "__main__":
    main()
