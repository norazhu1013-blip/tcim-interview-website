# 幼儿园教师游戏支持与引导AI访谈后端原型

这是一个可本地运行、可接OpenAI兼容模型接口的Python后端原型。它面向微信小程序后端开发，完成“测验后筛题—生成AI后台任务卡—调用题目知识库—AI连续访谈—结构化证据输出”的主流程。

## 1. 主要功能

- 严格按当前10题知识库顺序处理题号：
  1. 篮球架玩水
  2. 幼儿频繁求助
  3. 区域停留短
  4. 未参与小组建构
  5. 游戏兴趣点与常规价值不符
  6. 材料选择无层次
  7. 艾莎公主不运动
  8. 引水难题未解
  9. 飞行棋各走各的
  10. 跳绳秩序混乱
- 读取结果CSV与过程日志CSV。
- 生成 `AI访谈材料.xlsx`：
  - Sheet1：`AI安全访谈材料`
  - Sheet2：`AI后台任务卡`
- 每条任务卡用 `task_card_json` 保存完整结构。
- 读取10题16表知识库，重点调用：
  - `15AI访谈规则`
  - `16访谈输出证据规范`
- 拼接“总提示词 + 单题任务卡 + 知识库片段 + 访谈历史”。
- 提供FastAPI接口，支持微信小程序后端调用。
- 默认 `MOCK_MODEL=true`，可不配置API Key先跑通流程。

## 2. 目录结构

```text
ai_interview_backend_prototype/
├── ai_interview_backend/
│   ├── app.py                    # FastAPI入口
│   ├── cli.py                    # 命令行入口
│   ├── config.py                 # 配置
│   ├── question_bank.py          # 当前知识库题号顺序与题干选项
│   ├── scoring.py                # 结果解析与赋分
│   ├── process_features.py       # 过程日志解析与重点选项/重点比较
│   ├── knowledge_loader.py       # 10题知识库读取
│   ├── task_card_builder.py      # AI后台任务卡生成
│   ├── prompt_builder.py         # 总提示词与模型消息拼接
│   ├── model_client.py           # OpenAI兼容模型调用/模拟模型
│   ├── interview_state.py        # 单题访谈状态机
│   └── schemas.py                # API数据结构
├── scripts/
│   └── smoke_test.py             # 本地烟雾测试
├── requirements.txt
├── .env.example
└── README.md
```

## 3. 安装

```bash
cd ai_interview_backend_prototype
python -m venv .venv
source .venv/bin/activate  # Windows使用 .venv\Scripts\activate
pip install -r requirements.txt
```

## 4. 准备知识库

把10题统一16表知识库放到：

```text
./knowledge_base/
```

文件名建议保持：

```text
第1题_篮球架玩水_题目知识库_统一16表_AI访谈规则更新版.xlsx
...
第10题_跳绳秩序混乱_题目知识库_统一16表_AI访谈规则更新版.xlsx
```

也可以通过环境变量指定：

```bash
export KNOWLEDGE_DIR=/path/to/AI访谈知识库_10题统一16表_更新版
```

## 5. 生成AI访谈材料

结果CSV必须包含：

```text
participantName,userOpenid,answers
```

其中 `answers` 为JSON，键通常为0-9，值为选项下标数组，例如：

```json
{"0":[1,2,0,3],"1":[2,3,0,1]}
```

运行：

```bash
python -m ai_interview_backend.cli prepare data/exam_results_all.csv \
  --logs-csv data/logs_all.csv \
  --knowledge-dir ./knowledge_base \
  --output-dir ./outputs/advisor_run
```

输出：

```text
outputs/advisor_run/AI访谈材料.xlsx
outputs/advisor_run/ai_task_cards.json
```

## 6. 启动API服务

默认使用模拟模型：

```bash
uvicorn ai_interview_backend.app:app --host 0.0.0.0 --port 8000 --reload
```

健康检查：

```bash
curl http://127.0.0.1:8000/health
```

## 7. API流程

### 7.1 生成材料

```http
POST /admin/prepare-materials
```

请求：

```json
{
  "results_csv_path": "./data/exam_results_all.csv",
  "logs_csv_path": "./data/logs_all.csv",
  "output_dir": "./outputs/advisor_run",
  "knowledge_dir": "./knowledge_base"
}
```

### 7.2 开始访谈

可以直接传 `task_card_json`：

```http
POST /interview/start
```

```json
{
  "userOpenid": "openid_xxx",
  "final_rank": 1,
  "task_card_json": "{...}"
}
```

返回 `session_id` 和AI第一问。

### 7.3 继续访谈

```http
POST /interview/message
```

```json
{
  "session_id": "...",
  "teacher_message": "我当时主要想到孩子可能是在游戏里很兴奋。"
}
```

### 7.4 结束当前题并生成结构化证据表

```http
POST /interview/finish-item
```

```json
{
  "session_id": "..."
}
```

返回结构化证据：

```json
{
  "child_perspective_evidence": "...",
  "intervention_timing": "...",
  "value_balance": "...",
  "strategy_generation": "...",
  "key_quotes": ["..."],
  "unresolved_questions": "...",
  "ability_inference": "...",
  "support_suggestion": "...",
  "confidence": "medium"
}
```

## 8. 接入真实模型

复制 `.env.example` 为 `.env`，或设置环境变量：

```bash
export MOCK_MODEL=false
export MODEL_BASE_URL=https://api.deepseek.com/v1
export MODEL_API_KEY=sk-xxxx
export MODEL_NAME=deepseek-v4-flash
```

只要厂商兼容OpenAI `/chat/completions` 接口，一般只需替换以上三项。

## 9. 重要安全边界

- 教师端不得展示 `AI后台任务卡`、`task_card_json`、R/P/G、IIV、得分、排序正确性、入选原因。
- AI访谈中不得直接告诉教师标准答案。
- `研究者筛选材料` 与 `AI后台任务卡` 应仅供后台和研究人员使用。

## 10. 当前原型的边界

- 最终三题筛选采用轻量综合分，正式项目可替换为完整R/P/G筛题程序。
- 过程性数据解析兼容常见日志字段；如平台日志字段不同，需要在 `process_features.py` 中适配。
- 证据表在模拟模型下只返回占位结果；接入真实模型后才有实际语义判断。
