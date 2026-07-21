# 多语售后 Agent（可接 API 版）

出海设备厂多语售后 Agent：**知识库检索 + OpenAI 兼容 LLM + 真实数据统计**。
零 npm 依赖，Node.js 18+ 直接运行。

## 两种形态

| 形态 | 目录 | 适合场景 | LLM Key 在哪 |
|---|---|---|---|
| **在线静态版** | `docs/` | 发链接/二维码给人即时体验；GitHub Pages 托管 | 访客自己浏览器里填（localStorage，直连 LLM） |
| **服务端版** | `server.js` + `public/` | 正式交付试用：Key 保密、所有客户数据集中统计 | 服务端 `.env` |

在线版地址（二选一）：
- GitHub Pages（需在仓库 Settings → Pages 选 `main` 分支 `/docs` 目录）：`https://<你的用户名>.github.io/multilang-after-sales-agent/`
- 免配置即时生效（public 仓库直接可读）：`https://raw.githack.com/<你的用户名>/multilang-after-sales-agent/main/docs/index.html`

## 3 步上线

```bash
cd multilang-agent
cp .env.example .env     # 然后编辑 .env 填入你的 API Key
node server.js           # 启动，访问 http://localhost:8787
```

不配 Key 也能跑：进入**离线规则模式**（手册原文直出），方便先体验流程；配了 Key 重启即为完整 AI 模式。

## LLM 配置（.env）

任何 OpenAI 兼容接口都行，改三行即可：

| 服务商 | LLM_BASE_URL | LLM_MODEL |
|---|---|---|
| DeepSeek（便宜，推荐试水） | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |

## 目录结构

```
multilang-agent/
├── server.js            # HTTP 服务 + 对话主逻辑 + 统计聚合
├── lib/
│   ├── detect.js        # 语言识别（Unicode 区间 + 高频词打分）
│   ├── kb.js            # 知识库加载与检索打分
│   └── llm.js           # OpenAI 兼容调用（超时/报错兜底）
├── knowledge/           # ★ 知识库：一个 md 文件 = 一条手册条目
│   ├── E101-激光器过温.md
│   └── ...（共 9 条激光切割机示例）
├── public/index.html    # 服务端版页面（聊天 + 看板 + 知识库）
├── docs/                # ★ 在线静态版（GitHub Pages / 任意静态托管可直接部署）
│   ├── index.html       #   单文件应用：浏览器直连 LLM，Key 存访客 localStorage
│   └── kb-data.js       #   由 scripts/build-static.js 自动生成，勿手改
├── scripts/build-static.js  # knowledge/ → docs/kb-data.js 构建脚本
├── logs/chat.jsonl      # 服务端版每轮对话落一条日志（运行后自动生成，已 gitignore）
└── .env                 # API Key 配置（不要外传，已 gitignore）
```

## 换成客户的手册（交付动作）

1. 把客户 PDF/Word 手册按故障代码拆成若干 md 文件，丢进 `knowledge/`：

```markdown
---
code: E201                      # 故障代码（可无）
title: 冷水机流量报警 / Chiller Flow Alarm
severity: mid                   # high / mid / low
ref: 《XX 手册 V1.0》§8.1        # 来源，会随回答展示
keywords: 水流量,冷水机,chiller,flow,flujo,расход   # 检索关键词，中英+目标市场语言
---
## 症状 Symptom
（中英双语正文；其他语言模型会自动翻译，不用你写）
## 处理步骤 Steps
1. ...
```

2. 浏览器访问 `http://localhost:8787/api/reload-kb` 热加载，无需重启。
3. `.env` 里把 `DEVICE_NAME` / `MANUAL_NAME` 改成客户设备名。

## API

| 接口 | 说明 |
|---|---|
| `POST /api/chat` | 入参 `{message, history?, lang?}` → `{reply, lang, mode, escalated, sources, latencyMs}` |
| `GET /api/health` | LLM 是否已配置、知识库条目数 |
| `GET /api/kb` | 知识库条目列表 |
| `GET /api/stats` | 真实统计：总量/解决率/响应时长/语言分布/高频故障/最近会话 |
| `GET /api/reload-kb` | 热加载 knowledge/ 目录 |

`mode` 字段说明：`llm`=AI 正常回答；`offline`=未配 Key 规则直出；`llm-error`=API 故障降级；`no-hit`=知识库无命中（自动转人工并生成工单号）。

## 工作机制

```
用户提问（任意语言）
  → 语言识别（本地，零成本）
  → 知识库检索（故障代码精确命中 + 关键词打分，取前 3 条）
  → 有命中：手册摘录 + 铁律系统提示词 → LLM 用用户语言作答，只许依据摘录
  → 无命中 / 模型输出 [ESCALATE]：自动生成工单号，提示工程师 2 小时内联系
  → 每轮对话写入 logs/chat.jsonl → 数据看板实时聚合
```

防幻觉设计：系统提示词规定"只能依据手册摘录作答，摘录不足必须输出 [ESCALATE]"，服务端检出该标记即转为工单流程——这就是卖给工厂老板时"AI 不乱答"的承诺依据。

## 部署建议

- **上门演示**：笔记本 `node server.js`，手机连同一 WiFi 访问 `http://<电脑IP>:8787`，现场让老板用西语/泰语提问。
- **试用挂码**：丢到一台最便宜的云服务器（或 frp 内网穿透），把 URL 生成二维码，贴/拍照给客户挂到设备上。
- 试用两周后，`/api/stats` 的数据就是你回访谈钱的弹药。

## 注意

- `.env` 含 API Key，不要提交到任何公开仓库，也不要截图发给客户。
- 日志含客户提问原文，交付前确认客户对数据留存的要求。
