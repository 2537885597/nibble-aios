# AIOS 分阶段开发计划（基于已完成的 Nibble 节点1）

> 目标：从最小可用系统逐步扩张到完整 AIOS，每个开发节点（N1…N10）都可独立启动、独立验证；
> 任一单点失败都不让桌宠不可用。
>
> 本计划已根据架构评审（Kimi）修订，重点强化了：N2 的"路由器"抽象与降级契约、N4 提前的安全控制、
> N5 的向量库兜底、通信契约的补齐（error/heartbeat/config_sync/streaming）、一键脚本与依赖管理。

---

## 0. 全局设计原则（保证"不卡死"）

**核心原则：每个节点都是可独立启动、可独立验证的最小闭环；新能力以"插件式"挂在主链上，而非改写主干。**

降级兜底链（任一单点失败都不让桌宠不可用）：

- **Python 大脑宕机/未启动** → Nibble 走 `chatRouter` 降级链：先尝试 Python（带超时）→ 失败回退 `src/common/llm.js` 直连 → 再失败用罐头回复。启动**不阻塞**、**不强制**要求装 Python。
- **第三方 Agent（Aider）未安装/失败** → 编码类任务回退为"核心规划 + 人工确认"，不阻断。
- **向量库不可用** → 记忆回退到 SQLite/JSON 关键词检索（复用 Node1 的 `store.js` 思路）。
- **插件缺失** → 该能力不可用，其余照常。

既有 Nibble（`main.js` / `src/`）保持可用，N2 起把聊天核心路径抽象为 `chatRouter.js`，`main.js` 只换一行调用；
新增 `src/common/bridge.js`（Node↔Python 桥）、少量 UI 窗口（任务看板/技能面板）。

---

## 1. 已构建节点：N1 — 桌宠 Nibble（已完成）

| 项 | 内容 |
|---|---|
| 技术 | Electron（纯 Node.js，仅依赖 `electron` + `msedge-tts`），无打包框架 |
| 核心文件 | `main.js`（888 行：窗口/托盘/IPC/AI 调用/定时任务）、`preload.js`、`src/common/*`、`src/renderer/{pet,chat,settings}` |
| 已具备能力 | 桌宠渲染与状态动画（呼吸/眨眼/走动/睡觉）、聊天（OpenAI 兼容 `src/common/llm.js`）、ASR（Whisper 兼容 `asr.js`）、TTS（Edge TTS `edgeTts.js`）、好感度系统、每日摘要式长期记忆、本地 JSON 持久化（`store.js`） |
| 安全约束 | `contextIsolation=true`、`nodeIntegration=false`；所有渲染进程经 `preload.js` 的 `window.api` 与主进程通信 |
| 最高频路径 | `main.js:383 handleChatSend()` —— 当前直接调用 `chatCompletion` 并捕获异常回退罐头回复。**这是 N2 必须抽象为"路由器"的入口点** |

**N1 作为基线，后续所有节点都不得破坏其"开箱即用、无需 API Key 也能玩"的产品定位。**

---

## 2. 最终目标架构（混合栈）

```
┌──────────────────────────────────────────────────────────┐
│  Nibble 前端 (Electron, N1 已完成)                         │
│  桌宠本体 / 聊天 / 语音(ASR+TTS) / 任务看板 / 技能面板      │
└───────────────┬──────────────────────────────────────────┘
                │ WebSocket(事件流) + REST(简单请求)
┌───────────────▼──────────────────────────────────────────┐
│  Node 桥 (src/common/bridge.js, N2 新增) + chatRouter.js   │
│  - 懒连接 + 心跳  - 降级开关(大脑宕机→llm.js→罐头)        │
│  - 管理 Aider 子进程生命周期(含 risk_level 拦截, N4)       │
└───────┬───────────────────────────┬──────────────────────┘
        │ REST/WS                    │ spawn + pipe
┌───────▼────────────┐      ┌────────▼─────────┐
│ Python 大脑        │      │ Aider (CLI)       │
│ (aios-core/)       │      │ 首个第三方 Agent  │
│ Core Agent/记忆/   │      └──────────────────┘
│ 规划/蒸馏/插件     │
└────────────────────┘
```

---

## 3. 通信契约（N2 即固化，后续节点复用）

- **传输**：Electron 主进程与 `aios-core`（FastAPI，`uvicorn`，`localhost:8xxx`）之间用 WebSocket 做事件流，REST 做一次性请求（如健康检查、一次性 chat）。
- **统一错误信封（error envelope）**：所有失败响应统一为
  `{ "type": "error", "code": string, "message": string, "recoverable": bool }`
- **连接状态 / 心跳**：`{ "type": "heartbeat", "ts": number }` 与 `{ "type": "brain_status", "available": bool, "mode": "core"|"local"|"canned" }` —— 用于降级检测与 UI 提示。
- **LLM 配置透传（config_sync）**：`{ "type": "config_sync", "baseUrl", "apiKey", "model", "persona" }` —— 用户改设置时由 Node 主动推送给 Python 大脑（密钥仅留本机，不落盘到 core）。
- **消息类型（JSON）**：
  - `user_input`：`{text, modality, session_id}`（modality: text/voice/vision/file）
  - `ai_reply`：`{text, tts:bool, decision_trace?:[], stream?:bool, chunk?:string}` —— `stream` 为 true 时分片回传，最后一条带 `done:true`
  - `task_enqueue` / `task_status` / `task_done`：`{task_id, priority, state, progress, artifact?}`
  - `agent_dispatch`：`{agent:'aider', instruction, repo_path, context_files[], session_id, risk_level:'read'|'write'|'destructive', auto_approve:bool}`（Python→Node）
  - `agent_output` / `agent_done`：`{session_id, stdout_chunk | result, ok:bool, risk_level?}`（Node→Python）
  - `memory_write` / `memory_query`：`{tags[], content, project?}`
- **Aider 接口约定**：Node 桥负责 `start/send/interrupt/get_result`，以子进程方式运行；Python 只做编排与结果解读。早期（N4 PoC）用 `--message` 单次模式，长会话 API 模式后续迭代。

---

## 4. 开发节点（N1 已完成；N2–N10 每个都可独立运行）

### N2 — Python 大脑骨架 + 事件总线 + 本地记忆 + 路由器降级（架构奠基）
> ⚠️ 评审结论：N2 不是"只加一个文件"的简单节点，而是整个 AIOS 的架构奠基。必须把降级契约、脚本、依赖做实。

- **目标**：把 Nibble 的"智能回复"改由 Python 大脑出；建立 Node↔Python 通道、最朴素记忆（SQLite/JSON），并**抽象聊天路由器**与**懒连接降级**。
- **必做改造（对主干的明确侵入）**：
  - 新增 `src/common/chatRouter.js`：统一封装三级降级 `try Python(超时) → llm.js → 罐头回复`，并维护 `brainAvailable` 状态。
  - 修改 `main.js:383 handleChatSend`：仅改为 `return await chatRouter.send(text)` 一行调用，内部逻辑下沉到 router，后续 N3/N4 意图/任务分支复用同一入口。
  - 新增 `src/common/bridge.js`：**懒连接 + 心跳**模式——启动不阻塞、不强制要求 Python；首次聊天才尝试连接；连接失败立即标记 `brainAvailable=false` 并静默降级；`brain_status` 经 `pet:state`/新通道透传给 UI，避免误以为"大脑在线"。
- **依赖与脚本（同步落地，避免"装不上"困境）**：
  - `aios-core/pyproject.toml`：写清 `fastapi`、`uvicorn`、`websockets`（N2 仅此三项；向量/agent 依赖后续节点再加），注明 Python 3.11+。
  - `package.json` 补齐脚本：
    - `npm run dev:core` → `uvicorn aios-core.app.main:app --reload --port 8xxx`
    - `npm run dev` → 并行起 core + electron
    - `npm run test:core` → `pytest aios-core`
    - `npm run test:node` → `node --test src`
  - `.gitignore` 追加：`__pycache__/  *.pyc  .venv/  venv/  aios-core/.env  *.db  .chroma/`
- **交付/验证**：启动 `aios-core` + Nibble，说一句话 → 经 Python 返回回复；对话自动入库；UI 显示"大脑在线"。关掉 Python → 自动降级 `llm.js` 并 UI 提示"本地直连模式"；再关 Key → 罐头回复。三档均不崩。
- **新增**：`aios-core/app/main.py`(FastAPI+WS+heartbeat)、`aios-core/memory/store.py`(SQLite)、`src/common/bridge.js`、`src/common/chatRouter.js`。

### N3 — 意图解析 + 任务队列（"立即做" vs "加入队列"）
- **目标**：`chatRouter` 在"走大脑"分支内由大脑区分"闲聊 / 立刻执行 / 入队待办"，并建立带优先级的本地任务队列。复用 N2 同一路由器，不新增聊天入口。
- **交付/验证**："把整理桌面加入队列" → 看板出现待办；"现在陪我聊聊" → 立即回复。看板可暂停/追加。
- **新增**：`aios-core/planner/intent.py`、`aios-core/task_queue.py`、Nibble 任务看板窗口（`src/renderer/board/`）。
- **降级**：队列持久化在 SQLite，无大脑时队列不显示但仍可聊天（走 llm.js/罐头）。

### N4 — 第三方 Agent 统一接口 + Aider 接入（首个可调度工具人，安全前置）
> ⚠️ 评审结论：Aider 能改仓库/删文件，权限控制必须在本节点就做，不能等到 N10。

- **目标**：定义 `ThirdPartyAgent` 抽象与 Node 桥进程管理，接入 Aider；**默认最小权限**，把安全风险挡在第一步。
- **安全控制（N4 即落地）**：
  - 默认 `risk_level='read'`（只读/建议模式）；首次出现 `write`/`destructive` 类操作时弹窗确认。
  - `agent_dispatch` 携带 `risk_level` 与 `auto_approve`；Node 桥按风险等级决定是否拦截。
  - 设置中提供"允许 Aider 自动执行"显式开关，**默认关闭**。
- **通信预研（务实路径）**：N4 先以**单次 `--message` 调用 + 返回结果**做 PoC，验证端到端可行；**不把 Aider 长会话/REPL 流式解析提前写进架构**，待 PoC 稳定再迭代 API 模式。
- **交付/验证**：开启开关后"按我们风格实现一个登录模块" → 大脑规划 → Node 启动 Aider（注入记忆上下文与仓库路径，风险等级=write 需确认）→ 结果回看板与记忆。Aider 未装 → 任务标记"待人工"，不报错。
- **新增**：`aios-core/agents/base.py` + `aider_driver.py`、`src/common/agent_bridge.js`（spawn/pipe Aider + 风险拦截）。

### N5 — 向量记忆系统（检索增强，带兜底）
> ⚠️ 评审结论：Chroma 嵌入式模式在 Windows 上依赖 onnxruntime/原生 sqlite，可能装不上；需抽象接口 + SQLite 兜底。

- **目标**：引入向量检索落地"短期工作记忆 + 长期知识库 + 语义检索"。
- **实现策略**：先抽象 `BaseVectorStore` 接口；**默认实现用纯 SQLite + 简单向量运算（或 sqlite-vec）兜底**，Chroma/Qdrant 作为可选加速后端（运行时探测，装不上自动回退）。
- **交付/验证**："参考上次类似的 bug" → 语义检索命中历史成功路径并注入上下文。关掉/缺失向量库 → 自动回退 N2 关键词记忆，功能不中断。
- **新增**：`aios-core/memory/vector.py`(BaseVectorStore + SQLite 兜底 + Chroma 可选)、`retrieval.py`（向量+关键词+时间/项目过滤）。
- **强制规则**：非琐碎任务强制"先检索后行动"。

### N6 — Planner + Workflow 引擎 + 自主循环（类人自主工作流）
- **目标**：目标拆步（Plan-and-Execute / ReAct 混合），状态机支持"自主循环直到完成/超时/用户打断"，看板展示实时进度与中间产物（复用 N3 流式 `task_status` + N2 的 `stream` 回传）。
- **交付/验证**："持续优化训练脚本直到验证集提升2%" → 进入自主循环，定期 checkpoint，可随时打断追加。无 Aider 时仍可做"规划+汇报"循环。
- **新增**：`aios-core/planner/engine.py`（状态机）、`workflow_runner.py`。

### N7 — Skill Distiller（技能蒸馏，核心差异化，需量化验收）
- **目标**：执行中自动记录"成功路径+失败原因+关键决策"，把高频成功模式蒸馏成可复用 Skill（Prompt 模板+工具组合+检查清单）。
- **量化验收标准（新增，防止黑盒）**：定义"成功"=任务经自动化检查/人工评分通过；"高频"=同类任务出现 ≥ N 次且成功率 ≥ 阈值。新增一条可度量指标：**"同一类任务复用 Skill 后，自动化检查/人工评分通过率相对未复用基线提升 X%"**，并以回归用例固化。
- **交付/验证**："把刚才修 bug 的流程变成我的标准技能" → 生成 Skill 存档；下次同类任务自动注入并统计通过率提升。蒸馏逻辑只依赖记忆+规划，无需第三方 Agent 即可跑。
- **新增**：`aios-core/skills/distiller.py`、`skills/store.py`、Nibble 技能面板。

### N8 — 插件扩展系统（MCP 风格 Tool Schema）
- **目标**：统一插件协议，动态发现/描述/调用；首批：本地文件、终端、搜索（本地/网页/学术）、AIGC（文生图/润色）。插件在 Python 侧实现，独立于前端与 Agent。
- **交付/验证**："查一下 X 并生成周报" → 搜索插件 + AIGC 插件协同，结果经 `stream` 分片回看板。
- **新增**：`aios-core/plugins/registry.py` + 各插件实现，遵循 `name/description/schema/run` 协议。

### N9 — 多模态输入增强（视觉/截图/文件拖拽）
- **目标**：Nibble 接收截图选区、摄像头（可选）、文件/文件夹拖拽；视觉模型分析 → 喂给大脑；屏幕感知驱动主动搭话。
- **交付/验证**：拖一张截图给 Nibble → 解释/行动。复用 N1 的 ASR/TTS 与已有 IPC。
- **新增**：`src/renderer/pet/` 拖拽/截图处理、`aios-core/multimodal/vision.py`。

### N10 — 长期目标 + 主动推进 + 安全沙箱（完整系统）
- **目标**：长期目标分解与主动推进、定期汇报；高风险操作（删/提交/发邮件）默认确认+权限体系（**建立在 N4 已落地的 risk_level 之上，本节点做完整权限模型与跨设备同步可选**）。
- **交付/验证**：设定"本周完成 X 功能" → 系统拆解持续推进并每日汇报；删除/提交类操作弹确认。
- **新增**：`aios-core/goals.py`、`security/permissions.py`、沙箱配置。

---

## 5. 目录结构演进

```
deskmate-nibble/                 # 现有 Electron 前端（N1，保持不变）
├── main.js  src/  assets/  package.json  .gitignore(已扩充)
├── src/common/
│   ├── bridge.js                # N2 新增：Node↔Python 桥 + 懒连接/心跳/降级
│   ├── chatRouter.js            # N2 新增：三级降级路由器，main.js:383 改调它
│   ├── agent_bridge.js          # N4 新增：Aider 子进程管理 + 风险拦截
│   ├── llm.js  asr.js  edgeTts.js  store.js  personality.js  idleLines.js  # N1 既有
├── src/renderer/
│   ├── board/                   # N3 新增：任务看板
│   ├── skills/                  # N7 新增：技能面板
│   ├── pet/ chat/ settings/     # N1 既有
└── aios-core/                   # N2 新增 Python 微服务
    ├── app/main.py              # FastAPI + WebSocket + heartbeat + config_sync
    ├── memory/{store,vector,retrieval}.py
    ├── planner/{intent,engine}.py
    ├── agents/{base,aider_driver}.py
    ├── skills/{distiller,store}.py
    ├── plugins/registry.py + 各插件
    ├── multimodal/vision.py
    ├── goals.py  security/permissions.py
    └── pyproject.toml           # 依赖分步声明，N2 仅 fastapi/uvicorn/websockets
```

---

## 6. 验证与测试策略（每节点必做，且落到脚本）

- **一键脚本（N2 起即补齐）**：
  - `npm run dev:core` → 起 `uvicorn aios-core.app.main:app --reload`
  - `npm run dev` → 并行起 core + electron
  - `npm run test:core` → `pytest aios-core`
  - `npm run test:node` → `node --test src`
- **单元**：Python 侧 `pytest`（意图解析、检索、蒸馏、规划器）；Node 侧 `node --test`（chatRouter 三级降级、bridge 心跳/状态、agent 管道与风险拦截）。
- **降级用例（每条都写回归）**：①关 Python → 必须走 llm.js 且 UI 显"本地直连"；②关 Key → 罐头回复；③关向量库 → 关键词记忆；④Aider 未装 → 任务"待人工"；⑤关插件 → 其余照常。
- **接口契约测试**：WS/REST 消息用固定 fixture 双向校验，覆盖 `error` / `heartbeat` / `brain_status` / `config_sync` / `stream` 字段，防止前后端解耦后错位。

---

## 7. 里程碑与风险

| 里程碑 | 覆盖节点 | 可演示价值 |
|---|---|---|
| M1 智能中枢打通 | N2 | Nibble 真正"有大脑"，且三档降级不崩 |
| M2 任务化 | N3 | 一句话入队/立即执行 |
| M3 能干活（且安全） | N4 | 真能调度 Aider 写代码，权限可控 |
| M4 有记忆 | N5 | 越用越懂你，向量库装不上也不崩 |
| M5 自主化 | N6–N7 | 自主循环 + 技能沉淀（可量化） |
| M6 生态化 | N8–N10 | 插件/多模态/安全完整 AIOS |

**主要风险与缓解（已按评审修订）**：

- **N2 对主干侵入大于原描述** → 已在 N2 明确"抽象 `chatRouter.js` + 改 `main.js:383` 一行"，后续分支复用，避免反复改主干。
- **Python 未启动的产品行为模糊** → 已定为"懒连接 + 心跳 + 非阻塞启动 + UI 状态透传 + 允许纯 Node1 模式"。
- **Aider 安全风险偏晚** → 已把 `risk_level`、显式开关（默认关）、首次写操作确认**提前到 N4**。
- **Aider 子进程稳定性** → N4 先用 `--message` 单次 PoC 验证，不提前做长会话。
- **Chroma 在 Windows 兼容性** → N5 抽象 `BaseVectorStore`，SQLite 兜底，Chroma 可选。
- **契约缺字段** → N2 已补 `error` / `heartbeat` / `brain_status` / `config_sync` / `stream`。
- **测试流于口号** → N2 起即补齐 `dev/core/test` 脚本与降级回归用例。
- **依赖/忽略管理** → `.gitignore` 与 `pyproject.toml` 在 N2 同步落地。
- **Skill 蒸馏不可验证** → N7 新增量化通过率提升指标与回归用例。
