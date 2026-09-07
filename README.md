# NSTrans

面向 macOS、Windows、Android 与 iPadOS 的实时日文 OCR 与翻译覆盖工具。业务界面与平台原生能力分层，桌面端均可离线运行 OCR 与翻译模型。

## 当前能力

- 枚举并打开 USB 采集卡/摄像头（浏览器 `MediaDevices`）
- 左侧 1/4 画面预览，支持扩大预览和系统全屏
- macOS 开发版优先使用 Apache-2.0 的 meikiocr 游戏日文专用模型（常驻 ONNX 进程，热请求约 150 ms），不可用时回退 Apple Vision；其他平台暂回退 Tesseract.js
- Switch 游戏策略会保留相邻多行对话，并过滤 A/B/X/Y、L/R/ZL/ZR 操作提示、角落 HUD、小字号标签与假名注音碎片
- 基于文字包围框模糊原文并覆盖译文
- 分别显示采集、OCR、翻译、渲染和端到端延迟
- 唯一翻译模型为 TranslateGemma 4B；已下载的远程词库包和持久化翻译记忆优先命中，新短句、单词与对白才调用模型
- 同一帧长文本批量送入同一上下文；持续游戏对白会复用上下文，默认 45 秒无长文后自动开始新对话，也可手动重置
- 客户端不内置通用或单个游戏词库，只保留游戏类别；未来由服务器按游戏 ID 和版本分发词库包
- 未知专名可通过 Wikipedia 跨语言词条在后台学习，无需 API Key，非精确结果只保存为待确认候选
- 用户可选择是否共享本机产生的短文本译文和百科术语；默认关闭，服务器未配置前只写入本地待上传队列
- Tauri 2 桌面壳层以及 macOS 摄像头权限描述

TranslateGemma 4B 在本机执行。开启“在线学习专有名词”后，仅抽取出的候选专名会发送到 Wikimedia 公共接口；普通对白不会上传。

## 本机运行

需要 Node.js 20+。

```bash
npm install
npm run ocr:setup
npm run models:setup
npm run dev
```

`models:setup` 需要先安装 [Ollama](https://ollama.com/)，并下载 TranslateGemma 4B。开发时先运行 `ollama serve`；应用会检测模型并在翻译卡片显示状态。

浏览器访问 `http://127.0.0.1:5173`。首次启动预览时，macOS 会请求摄像头权限；USB 采集卡会作为视频设备出现在下拉框中。

桌面壳层还需要 Rust 1.77.2+：

```bash
rustup update stable
npm run desktop:dev
```

生成 macOS `.app` / `.dmg`（当前 Alpha 使用本地临时签名，不可直接公开分发）：

```bash
npm run desktop:build
```

产物位于：

```text
src-tauri/target/release/bundle/macos/NSTrans.app
src-tauri/target/release/bundle/dmg/NSTrans_0.1.0_aarch64.dmg
```

macOS 客户端内置 llama/ggml 运行时并自行管理 TranslateGemma 4B（首次运行下载约 3.3GB）；MeikiOCR 与 ONNX 权重随应用分发并作为主 OCR，Apple Vision 只在 MeikiOCR 不可用时回退。最终用户无需安装 Python 或启动外部模型服务。

## Windows 构建

Windows x64 客户端只使用 MeikiOCR，不加载 Apple Vision 或 Tesseract 回退。TranslateGemma 使用随应用分发的 Ollama/llama.cpp 运行时，用户可在控制台选择 CUDA、Vulkan 或 CPU；选择会保存在本机并在切换后重启模型进程。

构建机需要 Windows 10/11 x64、Node.js 20+、Rust stable、Visual Studio 2022 C++ Build Tools、WebView2，以及 Python 3.11。首次执行会下载官方 Windows Ollama 独立运行包，并把 MeikiOCR 与模型打包成离线 EXE：

```powershell
npm install
npm run windows:runtime
npm run windows:build
```

生成的 NSIS 安装程序位于：

```text
src-tauri\target\release\bundle\nsis\NSTrans_0.1.0_x64-setup.exe
```

## 验证

```bash
npm run test
npm run lint
npm run build
```

## 目录结构

```text
src/
  services/ocr.ts         OCR 工作线程、模型切换和文字区域提取
  services/translationRouter.ts  远程词库、翻译记忆与对话生命周期
  services/translationMemory.ts  跨平台可替换的持久化翻译记忆
  services/entityLookup.ts       Wikimedia 专名检索与后台学习队列
  services/dictionaryPacks.ts    版本化远程词库包仓库与分发接口
  services/knowledgeSharing.ts   用户授权控制的社区贡献待上传队列
  services/translationRuntime.ts 模型运行时接口与当前开发适配器
  gameAdapters/registry.ts       仅包含可选择的游戏类别元数据
  App.tsx                       采集、管线调度、覆盖层与控制台
native/translation/             旧模型迁移文件（当前运行路径不加载）
src-tauri/                macOS/Windows/Android 共用原生壳层
```

## 跨平台运行时边界

词库、翻译记忆、实体检索接口和上下文完全位于纯 TypeScript 层。当前 macOS 开发适配器用 Ollama 执行 TranslateGemma；发行版按平台替换底层执行器：

| 平台 | TranslateGemma 4B | 翻译记忆 | 实体检索 |
|---|---|---|---|
| macOS 开发版 | Ollama | localStorage | Wikimedia API |
| macOS/Windows 发行目标 | llama.cpp/GGUF | SQLite/键值存储 | 可替换 Provider |
| Android 发行目标 | llama.cpp JNI/GGUF | SQLite/键值存储 | 可替换 Provider |

模型只通过 `TranslationRuntime` 接口被业务层调用，所以切换 GGUF、CUDA、DirectML 或 NNAPI 不会修改 OCR 管线和 UI 配置。

## 下一阶段

1. 将 TranslateGemma 开发运行时封装为 Tauri sidecar，并为 Windows/Android 接入 GGUF 实现。
2. 对相邻帧的文字框做跟踪与去抖，避免译文闪烁，并继续优化假名注音合并。
3. 初始化并验证 Tauri Android 工程与 UVC 采集兼容性。
