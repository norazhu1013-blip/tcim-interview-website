# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from .task_card_builder import prepare_materials
from .interview_state import InterviewService


def cmd_prepare(args: argparse.Namespace) -> None:
    result = prepare_materials(args.results_csv, args.logs_csv, args.knowledge_dir, args.output_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))


async def _run_start(args: argparse.Namespace) -> None:
    service = InterviewService(args.knowledge_dir)
    task_json = Path(args.task_card_json_path).read_text(encoding="utf-8")
    session = await service.start(task_json)
    print(json.dumps({
        "session_id": session.session_id,
        "assistant_message": session.dialogue[-1]["content"],
        "stage": session.stage,
    }, ensure_ascii=False, indent=2))


def cmd_start(args: argparse.Namespace) -> None:
    asyncio.run(_run_start(args))


def main() -> None:
    parser = argparse.ArgumentParser(description="AI教师访谈后端原型命令行工具")
    sub = parser.add_subparsers(dest="command", required=True)

    p1 = sub.add_parser("prepare", help="根据测验结果、日志和知识库生成AI访谈材料")
    p1.add_argument("results_csv")
    p1.add_argument("--logs-csv", default=None)
    p1.add_argument("--knowledge-dir", default="./knowledge_base")
    p1.add_argument("--output-dir", default="./outputs/advisor_run")
    p1.set_defaults(func=cmd_prepare)

    p2 = sub.add_parser("start", help="用单条task_card_json启动一次访谈，便于本地测试")
    p2.add_argument("task_card_json_path")
    p2.add_argument("--knowledge-dir", default="./knowledge_base")
    p2.set_defaults(func=cmd_start)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
