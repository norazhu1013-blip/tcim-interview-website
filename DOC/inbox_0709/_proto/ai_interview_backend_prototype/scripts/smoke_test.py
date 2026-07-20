# -*- coding: utf-8 -*-
"""本地烟雾测试：创建最小结果CSV，复制知识库后生成AI访谈材料，并启动一个模拟访谈会话。

运行方式：
python scripts/smoke_test.py --knowledge-dir /path/to/AI访谈知识库_10题统一16表_更新版
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import csv
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ai_interview_backend.task_card_builder import prepare_materials
from ai_interview_backend.interview_state import InterviewService


def make_sample_results(path: Path) -> None:
    answers = {str(i): [0, 1, 2, 3] for i in range(10)}
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["participantName", "userOpenid", "answers"])
        writer.writeheader()
        writer.writerow({"participantName": "测试教师", "userOpenid": "openid_test", "answers": json.dumps(answers, ensure_ascii=False)})


async def run(args: argparse.Namespace) -> None:
    base = Path(args.workdir)
    results = base / "data" / "sample_results.csv"
    make_sample_results(results)
    out_dir = base / "outputs" / "advisor_run"
    print("1) 生成AI访谈材料...")
    info = prepare_materials(str(results), None, args.knowledge_dir, str(out_dir))
    print(json.dumps(info, ensure_ascii=False, indent=2))
    task_cards = json.loads((out_dir / "ai_task_cards.json").read_text(encoding="utf-8"))
    print("2) 启动模拟访谈...")
    service = InterviewService(args.knowledge_dir)
    session = await service.start(task_cards[0]["task_card_json"])
    print("AI：", session.dialogue[-1]["content"])
    session = await service.next_question(session.session_id, "我当时主要关注孩子是不是在游戏里有自己的想法，也担心现场会不会有规则问题。")
    print("AI：", session.dialogue[-1]["content"])
    session = await service.finish_item(session.session_id)
    print("3) 结构化证据：")
    print(json.dumps(session.evidence, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--knowledge-dir", required=True)
    parser.add_argument("--workdir", default="./_smoke_test")
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
