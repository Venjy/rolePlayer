# AI Role Player — 实时语音演示

[English](README.md) | **简体中文**

这是一个采用 React + Node.js/TypeScript、前后端位于同一仓库的可配置实时语音销售对练应用。学员可以选择存储在 SQLite 中的销售场景、兼容的客户角色和训练难度；浏览器随后通过服务端 WebSocket 网关将麦克风音频发送给 Qwen `qwen-audio-3.0-realtime-plus`，在聊天时间线中展示实时转写，并播放所选角色的语音。已经完成的文字对话和会话启动快照会保存在 SQLite 中，通过响应式历史记录导航展示，并可通过新的 Qwen 连接恢复文字上下文后继续交谈。项目还提供响应式管理控制台，用于维护角色和场景，并预览最终发送给模型的 Instructions。

移动端和桌面端共用同一套响应式 React 组件树。Ant Design 提供标准控件和主题算法，项目 CSS 负责聊天布局、消息气泡、录音浮层和随声音变化的波形效果。

## 仓库结构

本项目是单个根包，不是 monorepo。客户端、服务端、测试和共享协议定义共用同一份 `package.json`、锁文件、ESLint 配置、TypeScript 配置和 `.gitignore`。

```text
.
├── public/                         # 浏览器 AudioWorklet 模块
├── scripts/
│   ├── initialize-catalog.ts       # 显式、幂等的目录初始数据脚本
│   ├── split-database.ts           # 一次性旧数据库拆分脚本
│   └── smoke-realtime.ts           # 实时语音冒烟测试工具
├── src/
│   ├── client/
│   │   ├── admin/                  # 角色/场景管理控制台
│   │   ├── audio/                  # 麦克风采集与流式播放
│   │   ├── catalog/                # 目录 API 与选择状态
│   │   ├── components/             # 聊天消息与 VoiceWaveform
│   │   ├── conversations/          # 历史 API、状态、桌面侧栏/移动端 Drawer
│   │   ├── i18n/                   # 语言状态、持久化、Ant Design locale
│   │   ├── learner/                # 场景/角色/难度启动页
│   │   ├── realtime/               # 应用协议 WebSocket 客户端
│   │   └── voice/                  # 按住说话手势状态机
│   ├── server/
│   │   ├── catalog/                # 目录仓储、路由和初始化器
│   │   ├── conversations/          # 持久化会话仓储与 REST API
│   │   ├── database/               # SQLite 生命周期与迁移
│   │   └── realtime/               # Qwen 网关与上下文修复
│   └── shared/                     # 协议、目录 Schema、提示词编译器
├── test/                           # 单元测试与适配器测试
├── docs/                           # 架构与工程契约
├── index.html
├── eslint.config.js
├── vite.config.ts
└── package.json
```

`pnpm-workspace.yaml` 只包含 pnpm 对 `esbuild` 的依赖构建许可列表，并没有定义任何 workspace package。

## 环境要求

- Node.js 22.13.0 或更高版本（项目直接使用 `node:sqlite`）
- pnpm 11 或更高版本
- 阿里云百炼中国内地（北京）地域的 API Key
- 已获得 `qwen-audio-3.0-realtime-plus` 访问权限的 Workspace ID

官方配置文档：

- [获取 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)
- [获取 Workspace ID](https://help.aliyun.com/zh/model-studio/obtain-the-app-id-and-workspace-id)
- [Qwen Audio Realtime 使用指南](https://help.aliyun.com/zh/model-studio/qwen-audio-realtime-user-guides)

## 本地启动

1. 安装依赖：

   ```bash
   pnpm install
   ```

2. 创建本地环境变量文件：

   ```bash
   cp .env.example .env
   ```

3. 配置 `.env`。开始语音会话前，需要填写北京地域的凭据：

   ```dotenv
   DASHSCOPE_API_KEY=sk-ws-...
   DASHSCOPE_WORKSPACE_ID=ws_...
   ```

   SQLite 默认使用两个文件：`data/catalog.sqlite` 保存角色、场景、预设和兼容关系；`data/conversations.sqlite` 保存会话快照与最终消息。可分别通过 `CATALOG_DATABASE_PATH` 和 `CONVERSATION_DATABASE_PATH` 覆盖。相对路径从进程工作目录解析，父目录会自动创建。

   如果从仍使用 `data/role-player.sqlite` 的旧版本升级，请先停止服务，等待旧库的 `-wal`/`-shm` 文件消失，然后执行一次 `pnpm database:split`。该命令会保留旧源文件，并且不会覆盖任何已经存在的新数据库文件。

4. 初始化数据库中的双语角色/场景选项和初始目录：

   ```bash
   pnpm catalog:init
   ```

   该命令会打开 `CATALOG_DATABASE_PATH`，执行尚未应用的 Schema 迁移，并在一个事务中从 JSON 插入缺少的双语目录默认值。数据库 ID 由 SQLite 自动生成；JSON 中稳定的初始化键和冲突忽略写入保证命令可以安全重复执行，不会生成重复数据，也不会覆盖管理员修改。只有 skipped 行表示数据已经存在，不是报错；运行时不需要 Qwen 凭据。

5. 启动 React 和 Node.js 开发服务器：

   ```bash
   pnpm dev
   ```

6. 打开 [http://localhost:5173](http://localhost:5173)，选择训练场景、兼容角色和难度，点击 **Start voice practice（开始语音对练）**，并允许浏览器使用麦克风。在宽屏设备上使用左侧历史栏，在较小屏幕上使用页面头部的 Drawer 按钮，即可重新进入并继续历史会话。通过 **Admin console（管理控制台）** 可以新建或编辑目录数据。界面首次使用时默认为英文，可通过右上角语言按钮切换到中文。

7. 说话时按住 **Hold to talk（按住说话）**，松开发送；向上滑动至少 72 px 后再松开可取消。如果角色正在说话，按钮会变为 **Hold to interrupt and talk（按住打断并说话）**；按住后会立即停止当前播放、开始上下文修复，并录制下一轮输入。

不要将真实 API Key 写入源代码、提交到 Git，或通过 `VITE_*` 环境变量暴露给浏览器。

### 仅用于 UI 开发的预览模式

如果只需要检查布局，不希望授权麦克风或建立 Qwen 会话，可以在 Vite 运行时使用以下仅限开发环境的固定预览数据：

- [http://localhost:5173/?preview=session](http://localhost:5173/?preview=session) — Alex 正在说话的已填充对话
- [http://localhost:5173/?preview=recording](http://localhost:5173/?preview=recording) — 正在录音的波形和底部布局

这些地址复用生产环境 React 组件，但注入静态内存状态。语音控件在预览模式下不会实际工作，生产构建会忽略 `preview` 参数。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 同时运行 Vite 和 Node.js 服务端 |
| `pnpm dev:client` | 仅运行 React 开发服务器 |
| `pnpm dev:server` | 仅运行 Node.js TypeScript 服务端 |
| `pnpm catalog:init` | 使用 TypeScript 源码执行迁移，并幂等补充缺少的预设和示例角色 |
| `pnpm catalog:init:prod` | 构建后，在启动服务前对部署数据库运行初始化器 |
| `pnpm database:split` | 将旧的合并数据库一次性复制为独立的目录库和会话库 |
| `pnpm database:split:prod` | 执行构建后的一次性数据库拆分器 |
| `pnpm lint` | 运行共享 ESLint 配置 |
| `pnpm typecheck` | 检查客户端、服务端和共享代码的类型 |
| `pnpm test` | 运行全部测试一次 |
| `pnpm smoke:realtime <pcm-file> [interrupt flag]` | 通过本地 Node.js 网关验证正常或中断的 Qwen 实时会话 |
| `pnpm build` | 将 Node.js 服务端/初始化器构建到 `dist/server`，将 React 构建到 `dist/client` |
| `pnpm check` | 依次执行 lint、类型检查、测试和两端构建 |

### 可选：实时语音冒烟测试

在 `pnpm dev:server` 运行时，可以通过 SPA 使用的同一个网关发送任意无文件头的 PCM16、16 kHz、单声道录音：

```bash
pnpm smoke:realtime /absolute/path/to/input.pcm
```

该命令会通过本地 REST API 创建一个正常的持久化会话。只有在收到已持久化的用户转写、助手转写、流式助手音频，以及模拟播放完成后的响应级 `response.persisted` 确认时才会成功。因此，它产生的最终文字会出现在历史记录中。测试脚本不会读取 Qwen 凭据；凭据始终只存在于 Node.js 服务进程内。

加入 `--interrupt` 可以等待模型生成结束后，模拟在排队音频播放过程中停止，并验证 Qwen 已确认助手消息的删除/重建修复事务：

```bash
pnpm smoke:realtime /absolute/path/to/input.pcm --interrupt
```

使用 `--interrupt-during-generation` 可以验证生成过程中的取消路径。在尚无可信语速历史时，该路径必须删除部分生成的助手消息，并保守地不保留任何估算文字。

## 当前功能

- 学员启动页、目录管理和语音聊天使用同一个响应式 Ant Design SPA，同时适配移动端和桌面端；没有独立移动应用或重复组件树
- 中英文界面，首次使用默认为英文；右上角提供语言切换，Ant Design locale 保持同步，并将 `role-player:locale` 保存到 `localStorage`
- 支持明暗主题，根据保存值或系统偏好初始化，并可从右上角切换
- 学员启动页提供可搜索的场景和角色选择、兼容性过滤、Ant Design 简单/中等/困难单选按钮，以及目标、技能重点、角色语音行为和性格摘要
- 响应式管理控制台，角色/场景独立编辑，兼容关系单独管理，评分权重由成功标准生成，并提供各自独立的 Instructions 预览
- 数据库驱动的双语角色预设，以及训练目标、重点技能和成功标准等场景预设；客户端不再内置角色/场景业务选项
- 每个需要本地化的角色/场景字段都独立保存中英文；界面优先显示当前语言，缺失时回退另一语言，管理表单只更新当前编辑语言，不会把回退文字误存为翻译
- 完整双语的初始角色和场景由 JSON 定义并写入 SQLite；用户填写的内容不会经过机器翻译
- 角色姓名、年龄、背景和行为备注支持自由输入，编辑历史或自定义角色时会保留不在预设中的现有值
- 角色负责职业、语气、音色、说话节奏和挑战倾向；场景负责情境、目标、技能、成功标准以及由成功标准生成的评分权重
- 使用确定性的 `compileRolePlayInstructions` 模板，不调用额外大模型将结构化目录字段转换为 Qwen 系统提示词
- Instructions 共用 12,000 字符限制，保存兼容关系前会检查所有兼容角色和三个训练难度
- 启动会话时，将所选角色的 `voice` 以及由角色/场景/难度编译出的 Instructions 快照发送给 Qwen，因此后续目录编辑只影响新会话
- SQLite 持久化会话历史，包括不可变启动快照、已完成的用户/助手文字、活动时间排序和完整记录重新加载
- 响应式历史导航：1200 px 及以上显示固定 288 px 左侧栏，更窄屏幕复用 Ant Design Drawer，并提供当前项状态和新建对练入口
- 通过新的 Qwen WebSocket 恢复文字上下文：Node.js 恢复已保存的 Instructions/voice，并等待最近历史的 `conversation.item.create` 确认后才宣布会话就绪
- 切换会话、新建对练和结束会话会串行执行，并在断开前等待用户/助手的响应级持久化确认；保存失败会明确报错，不会静默丢弃最后一轮
- 对话记录固定在底部，展示实时用户/助手草稿、时间戳和已中断标签
- 鼠标、触摸、触控笔、空格键和 Enter 键均支持按住录音；松开发送，向上滑动取消
- 录音时展示随声音变化的麦克风波形、录音时长和松开操作说明
- 浏览器麦克风采集请求开启回声消除、噪声抑制和自动增益控制
- 将浏览器设备采样率流式降采样为 PCM16 16 kHz 单声道
- 提交前等待 AudioWorklet 尾部缓冲区确认，避免末尾音节被截断
- Node.js WebSocket 代理负责服务端 Qwen 鉴权，浏览器不会接触密钥
- 流式播放 Qwen 返回的 PCM16 24 kHz 音频，支持音量、静音、停止回复和结束会话
- 响应级播放确认，以及尽力而为的中断回复上下文修复
- 独立的 SQLite 目录库/会话库、Fastify 生命周期管理、无常驻 WAL/SHM 文件的回滚日志事务、外键、busy timeout、只追加迁移器、持久化目录 CRUD，以及显式、事务化、幂等的目录初始化器
- 分阶段错误处理：首次初始化失败返回启动页；会话就绪后始终保留聊天页面，错误通过顶部 Ant Design message 显示 5 秒；致命错误会基于 SQLite 最终文字安全重建连接，重建失败时可从底部按钮重试

## 持久化状态

新建的目录库和会话库拥有彼此独立的迁移历史，只包含各自领域的表。每一类预设都有独立物理表，角色和场景只引用预设 ID，不再重复保存双语标签。历史合并数据库仍保留迁移 1–15，供 `pnpm database:split` 安全升级并复制旧数据。Schema 迁移只负责结构，业务默认值必须显式初始化。目录 REST API 如下：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/catalog` | 读取 `personaPresets`、`scenarioPresets`、双语角色/场景和兼容 ID |
| `POST`、`PUT`、`DELETE` | `/api/personas`、`/api/personas/:id` | 新建、整体替换或删除角色 |
| `POST`、`PUT`、`DELETE` | `/api/scenarios`、`/api/scenarios/:id` | 新建、整体替换或删除场景 |

每次管理控制台修改成功后，会先更新本地目录状态，再重新读取权威目录。因此学员选择项无需重新构建或重启即可立即反映保存结果，即使后续读取暂时失败也能保持正确。场景仍在引用某个角色时不能删除该角色；必须先移除兼容关系。删除场景只会级联删除其兼容关系。

会话 REST API 如下：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/conversations` | 根据角色/场景 ID 读取权威数据、保存双语快照、编译 Instructions，并创建持久化会话 |
| `GET` | `/api/conversations` | 按最新持久化活动时间列出全部会话 |
| `GET` | `/api/conversations/:id` | 读取一个不可变启动快照及其有序最终消息 |

业务默认值只定义在 `src/server/catalog/initial-data/*.json` 中。源码开发通过 `pnpm catalog:init` 安装，构建后通过 `pnpm catalog:init:prod` 安装。初始化器写入双语预设、三个双语示例角色和三个双语场景；SQLite 自增 ID、稳定初始化键与事务化冲突容忍写入保证重复运行不产生重复数据，也不会覆盖管理员已有记录。

系统会在会话数据库中持久化会话快照、所选难度、编译后的 Instructions、音色和最终转写文字。流式草稿、麦克风/模型音频、用户和评估数据不会持久化。目前的私有单用户部署暴露一份全局历史记录，尚无会话删除 API 或保留期限任务。完整契约请参阅[目录与提示词编译](docs/CATALOG_AND_PROMPTS.md)和[数据库](docs/DATABASE.md)。

默认 `data/` 目录已被 Git 忽略。未来采用单容器部署时，必须将该目录挂载为持久化存储；如果将数据库文件放入临时镜像层，容器替换后会丢失目录编辑结果。

## 当前限制

由于 Qwen 不提供单词级音频时间戳，浏览器也无法证明哪些声音真正到达用户的物理输出设备，因此中断回复的截断位置只能估算。当证据不足时，应用会优先删除整个被中断的助手回复。

角色的 `voiceBehavior.interruptFrequency` 只会调整提示词层面的耐心程度、插话和质疑行为。演示应用使用手动按住说话（`turn_detection: null`），因此模型无法在学员说话过程中自主打断。角色说话时由学员触发的打断属于独立的播放中断功能。

历史会话续聊属于文字上下文重建，并不是恢复旧 Qwen 会话或重放原始音频。它可以恢复转写语义上下文，但不能恢复学员语气或情绪等声音细节。模型目前接收最近 20 个用户轮次，界面则保留完整历史记录。

演示应用尚未实现身份认证/管理权限、按用户区分的历史记录归属、会话删除/保留期限控制、评估持久化、反馈/评分生成、多次传输重试与退避、生产限流、Docker，以及生产环境静态文件服务。

当前构建产物已经按以下结构分离：

```text
dist/client/   # Vite SPA 构建结果
dist/server/   # Node.js 服务端与目录初始化器
```

计划中的生产部署步骤是：为 Fastify 增加 `dist/client` 静态文件服务，将两个目录打包进同一个 Docker 镜像，并只暴露 Node.js 服务。容器启动时必须挂载持久化数据库目录，针对该卷运行 `pnpm catalog:init:prod`，然后再启动 Node.js 服务。初始化不依赖 Qwen 凭据。Docker 和静态服务工作会在真实凭据验证实时语音核心后继续推进。

## 常见问题

### 角色编辑器提示缺少必填预设

必要时先停止开发服务器，确认 `CATALOG_DATABASE_PATH`，运行 `pnpm catalog:init`，然后重新加载 SPA。构建后的部署环境应在启动服务前，针对同一个持久化卷运行 `pnpm catalog:init:prod`。这些命令不需要 Qwen 凭据。

### 目录初始化拒绝过长的场景关联

错误中指定的示例角色/默认场景组合，在对应难度下超过了 12,000 字符 Instructions 限制，通常由管理员编辑造成。请精简该角色或场景配置后重新运行初始化；失败的执行不会提交任何初始化数据。

### 开始按钮提示尚未配置凭据

创建 `.env`，填写两个必需值，然后重新启动 `pnpm dev`。服务端只会在进程启动时读取密钥。

### Qwen 返回 HTTP 401 或 403

请确认：

- API Key 属于中国内地（北京）地域；
- Workspace ID 来自同一地域；
- Workspace 已获得 `qwen-audio-3.0-realtime-plus` 访问权限；
- 两个值都没有引号或结尾空格。

### 无法访问麦克风

麦克风采集要求页面运行在 `localhost` 或 HTTPS 环境。请检查浏览器站点级麦克风权限，确认输入设备可用，然后重新加载页面。

### 有转写文字但听不到音频

请检查页面音量和静音控件、系统输出设备，以及浏览器标签页的音频权限。Qwen 返回原始 PCM 而不是 MP3 或 WAV，因此应用使用 Web Audio 播放。

### 服务端无法打开 SQLite 数据库

请确认 Node.js 进程对 `CATALOG_DATABASE_PATH` 和 `CONVERSATION_DATABASE_PATH` 的父目录具有写权限。相对路径会从进程启动目录解析。不要将生产数据库放在只读或临时容器路径中。

## 更多文档

- [架构](docs/ARCHITECTURE.md)
- [界面交互](docs/UI_INTERACTIONS.md)
- [实时协议](docs/REALTIME_PROTOCOL.md)
- [数据库](docs/DATABASE.md)
- [目录与提示词编译](docs/CATALOG_AND_PROMPTS.md)
- [AI 开发者说明](AGENTS.md)
