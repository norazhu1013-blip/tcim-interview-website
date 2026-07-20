# -*- coding: utf-8 -*-
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from .utils import clean_sort_value, parse_float, parse_int, read_csv_dicts


@dataclass
class ProcessFeature:
    userOpenid: str
    questionIndex: int
    teacherInitialOrder: str = ""
    teacherFinalOrder: str = ""
    orderChanged: bool = False
    priorityOption: str = ""
    priorityPair: str = ""
    revision_count: int = 0
    action_count: int = 0
    process_hint: str = "过程信息不足，主要围绕情境理解和选项比较追问。"


def _timestamp_seconds(value: Any) -> Optional[float]:
    t = parse_float(value)
    if t is None:
        return None
    return t / 1000.0 if t > 1e10 else t


def infer_log_base(log_rows: List[Dict[str, str]]) -> int:
    qs = [parse_int(r.get("questionIndex")) for r in log_rows]
    qs = [q for q in qs if q is not None and q != -1]
    if 0 in set(qs):
        return 0
    return 1


def group_events(logs_csv_path: Optional[str]) -> Dict[Tuple[str, int], List[Dict[str, Any]]]:
    if not logs_csv_path:
        return {}
    rows = read_csv_dicts(logs_csv_path)
    if not rows:
        return {}
    base = infer_log_base(rows)
    grouped: Dict[Tuple[str, int], List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        user = row.get("userOpenid", "")
        raw_q = parse_int(row.get("questionIndex"))
        if raw_q is None or raw_q == -1:
            continue
        q = raw_q + 1 if base == 0 else raw_q
        if q < 1 or q > 10:
            continue
        t = _timestamp_seconds(row.get("timestamp"))
        if t is None:
            continue
        event = dict(row)
        event["_timestamp"] = t
        grouped[(user, q)].append(event)
    for key in grouped:
        grouped[key].sort(key=lambda e: e["_timestamp"])
    return grouped


def build_trajectory(events: List[Dict[str, Any]], final_comb: str) -> Tuple[List[str], List[str], List[Tuple[str, str]]]:
    trajectory: List[str] = []
    moved_options: List[str] = []
    transitions: List[Tuple[str, str]] = []
    drag_events = [e for e in events if e.get("action") == "change_sorting_option"]
    for event in drag_events:
        previous_comb = clean_sort_value(event.get("previousValue"))
        current_comb = clean_sort_value(event.get("currentValue"))
        answer = str(event.get("answer", "")).strip().upper()
        if answer in {"A", "B", "C", "D"}:
            moved_options.append(answer)
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


def option_focus(trajectory: List[str], moved_options: List[str], transitions: List[Tuple[str, str]]) -> Tuple[str, str]:
    priority_option = ""
    best_score = 0
    if trajectory:
        initial, final = trajectory[0], trajectory[-1]
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
        changed = [opt for opt in "ABCD" if opt in prev and opt in cur and prev.index(opt) != cur.index(opt)]
        for i in range(len(changed)):
            for j in range(i + 1, len(changed)):
                pair_counter["/".join(sorted((changed[i], changed[j])))] += 1
    priority_pair = pair_counter.most_common(1)[0][0] if pair_counter else ""
    return priority_option, priority_pair


def build_process_features(results: List[Any], logs_csv_path: Optional[str]) -> Dict[Tuple[str, int], ProcessFeature]:
    grouped = group_events(logs_csv_path)
    features: Dict[Tuple[str, int], ProcessFeature] = {}
    for result in results:
        events = grouped.get((result.userOpenid, result.questionIndex), [])
        trajectory, moved_options, transitions = build_trajectory(events, result.chosen_comb)
        initial = trajectory[0] if trajectory else result.chosen_comb
        final = result.chosen_comb
        priority_option, priority_pair = option_focus(trajectory, moved_options, transitions)
        revision_count = max(0, len(trajectory) - 1)
        action_count = len([e for e in events if e.get("action") == "change_sorting_option"])
        hint_parts = []
        if priority_pair:
            hint_parts.append(f"可围绕{priority_pair}两个选项的比较追问。")
        if priority_option:
            hint_parts.append(f"可追问教师对{priority_option}选项的理解和排序依据。")
        if revision_count >= 2:
            hint_parts.append("教师作答过程中存在多次调整，可用中性语言追问其是否在几个做法之间进行过权衡。")
        if not hint_parts:
            hint_parts.append("过程相对平稳，主要追问教师最初关注点、判断依据和现场策略。")
        features[(result.userOpenid, result.questionIndex)] = ProcessFeature(
            userOpenid=result.userOpenid,
            questionIndex=result.questionIndex,
            teacherInitialOrder=initial,
            teacherFinalOrder=final,
            orderChanged=initial != final,
            priorityOption=priority_option,
            priorityPair=priority_pair,
            revision_count=revision_count,
            action_count=action_count,
            process_hint="".join(hint_parts),
        )
    return features
