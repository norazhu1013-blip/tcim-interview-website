# -*- coding: utf-8 -*-
from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


def read_csv_dicts(path: str | Path) -> List[Dict[str, str]]:
    path = Path(path)
    last_error = None
    for enc in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            with path.open("r", encoding=enc, newline="") as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError as exc:
            last_error = exc
    raise RuntimeError(f"无法读取CSV编码：{path}") from last_error


def safe_json_loads(text: str, default: Any = None) -> Any:
    if not text:
        return default
    try:
        return json.loads(text)
    except Exception:
        return default


def clean_sort_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    value = str(value).strip().strip('"').strip("'")
    if not value or value.lower() == "nan":
        return None
    letters = re.findall(r"[ABCD]", value.upper())
    if len(letters) == 4:
        return "".join(letters)
    return None


def ensure_dir(path: str | Path) -> Path:
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    return path


def compact_join(items: Iterable[str], sep: str = "；") -> str:
    return sep.join([str(x).strip() for x in items if str(x).strip()])


def json_dumps_cn(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def parse_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except Exception:
        return default


def parse_float(value: Any, default: Optional[float] = None) -> Optional[float]:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default
