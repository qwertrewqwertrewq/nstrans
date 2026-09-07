# NSTrans

[![CI](https://github.com/qwertrewqwertrewq/nstrans/actions/workflows/ci.yml/badge.svg)](https://github.com/qwertrewqwertrewq/nstrans/actions/workflows/ci.yml)

面向 macOS、Windows、Android 与 iPadOS 的实时日文 OCR 与翻译覆盖工具。业务界面与平台原生能力分层，桌面端均可离线运行 OCR 与翻译模型。

## 平台实测状态

| 平台 | 测试设备 | 当前状态 |
|---|---|---|
| macOS | Apple M4、16GB RAM | 运行良好；MeikiOCR 为默认引擎，也可切换 Apple Vision |
| iPadOS | Apple M2、8GB RAM | 使用 TranslateGemma 4B IQ4_XS，运行效果尚可；当前提供未签名 IPA，需用户使用自己的证书自签 |
| Android | Snapdragon 750G、8GB RAM、Android 11 | 仅验证应用能够打开；由于缺少更高性能 Android 设备，尚未验证实际 OCR、模型速度和长时间运行效果 |
| Windows | Windows 10/11 x64 | 已完成 Windows x64 原生构建并生成 NSIS 安装程序；实机功能与性能仍在验证，OCR 固定使用 MeikiOCR，翻译后端可选 CUDA、Vulkan 或 CPU |

以上结论只代表列出的设备和当前 Alpha 构建，不构成对其他硬件性能、稳定性或兼容性的保证。

## 隐私与版权边界

- 视频画面、截图和完整 OCR 识别文本只在客户端即时处理，不上传至 NSTrans 社区服务器，服务器也不保存用户截取画面中的对白、剧情文本或画面内容。
- 客户端本机只会为复用翻译而缓存符合限制的专有名词、单词和短菜单标签；不会建立视频、截图或长篇游戏文本档案。用户可以通过清除应用数据移除这些本地缓存。
- “共享本地词库贡献”默认关闭。开启后仍只允许上传经过长度、结构和标点过滤的专有名词、单词与短句，不允许上传对白、描述或连续剧情文本。
- 自动学习的专业词汇来自 Wikipedia、Wikidata 等公开可访问渠道，并保存来源链接；搜索候选只作为模型术语提示，不会把网页内容复制进游戏文本库。
- NSTrans 不包含、托管或授权任何游戏画面、剧情文本、商标或其他游戏资产。相关权利归各自权利人所有；本项目与任天堂及其他游戏发行商、开发商无隶属或背书关系。

## 当前能力

- 枚举并打开 USB 采集卡/摄像头（浏览器 `MediaDevices`）
- 左侧 1/4 画面预览，支持扩大预览和系统全屏
- macOS 默认使用 Apache-2.0 的 MeikiOCR 游戏日文模型并可切换 Apple Vision；Windows 与 Android 使用 MeikiOCR；iPadOS 只使用 Apple Vision
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

生成 macOS `.app` / `.dmg`（当前 Alpha 未做 Apple Developer ID 签名和公证，首次打开可能需要在系统设置中确认）：

```bash
npm run desktop:build
```

产物位于：

```text
src-tauri/target/release/bundle/macos/NSTrans.app
src-tauri/target/release/bundle/dmg/NSTrans_0.1.0_aarch64.dmg
```

macOS 客户端内置 Ollama 运行时并自行管理 TranslateGemma 4B（首次运行下载约 3.3GB）。NSTrans 会在本机回环地址启动隔离的 Ollama 服务，不依赖用户另行安装或启动 Ollama；MeikiOCR 与 ONNX 权重随应用分发并作为主 OCR，Apple Vision 只在 MeikiOCR 不可用时回退。最终用户无需安装 Python 或启动外部模型服务。

## iPadOS 构建

iPadOS 只使用 Apple Vision OCR。默认构建无签名 IPA，方便用户使用自己的开发证书自签；需要 Xcode 16、Rust iOS target 和 Tauri iOS 工程：

```bash
rustup target add aarch64-apple-ios
npm run ios:build
```

产物位于 `src-tauri/gen/apple/build/arm64/NSTrans.ipa`。如果构建机已配置开发团队并希望让 Xcode 正常签名和导出，可设置 `NSTRANS_IOS_ALLOW_SIGNING=1` 后构建。

## Android 构建

Android 当前只提供 arm64 调试签名测试包，需要 Android SDK、NDK、Java 17 与 Rust Android target：

```bash
rustup target add aarch64-linux-android
npm run android:build
```

产物位于 `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`。该包只用于兼容性测试，不应视为经过发布签名的正式版本。

## Windows 构建

Windows x64 客户端只使用 MeikiOCR，不加载 Apple Vision 或 Tesseract 回退。TranslateGemma 使用随应用分发的 Ollama 运行时，用户可在控制台选择 Ollama 的 CUDA、Vulkan 或 CPU 推理后端；选择会保存在本机并在切换后重启模型进程。

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

## GitHub Actions 自动构建

`.github/workflows/ci.yml` 会在 `main` 的提交和拉取请求上执行测试、Lint 与前端构建。跨平台安装包不会在每次提交时重复生成，以控制构建时间和存储占用。

推送 `v*` 标签会触发 `.github/workflows/release.yml`，并行生成 Windows x64 NSIS、macOS Apple Silicon DMG、未签名 iPadOS IPA 和 Android arm64 调试 APK，然后使用仓库自动提供的 `GITHUB_TOKEN` 直接上传到对应 GitHub Release：

```bash
git tag v0.1.1
git push myrepo v0.1.1
```

也可以在 GitHub 的 Actions 页面手动运行 “Cross-platform release”，填写一个已经存在的标签。工作流默认创建或沿用预发布版本，不需要保存 Apple 证书、Android keystore 或个人访问令牌。当前 iPadOS 产物仍由用户自行签名，Android 产物仍是调试签名；正式发行签名应在后续通过 GitHub Environments 单独配置。

## Alpha 构建下载

[GitHub Releases](https://github.com/qwertrewqwertrewq/nstrans/releases) 提供 Windows x64 安装程序、macOS Apple Silicon DMG、需要自签的 iPadOS IPA，以及未经性能验证的 Android arm64 APK。它们仅供测试，不代表正式发布质量；模型通常需要首次启动后另行下载或由用户选择本地文件。

发行包不包含游戏画面、测试录像、剧情文本或 TranslateGemma 模型权重。仓库中的本地摄像头测试脚本只负责产生或读取开发者自行准备的测试输入，测试录像不会提交到版本库或上传到 Release。

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

词库、翻译记忆、实体检索接口和上下文完全位于纯 TypeScript 层。各平台当前使用的实际 LLM 接入方式如下：

| 平台 | NSTrans 实际接入层 | 推理配置 | 模型格式 |
|---|---|---|---|
| macOS 发行版 | 应用内置 Ollama，通过本机回环地址调用 `/api/chat` | Ollama 自动使用可用的 Apple Silicon/Metal 后端 | Ollama 模型或导入的 GGUF |
| Windows 发行版 | 应用内置 Ollama，通过本机回环地址调用 `/api/chat` | 用户可选择 Ollama 的 CUDA、Vulkan 或 CPU 后端 | Ollama 模型或导入的 GGUF |
| Android | Rust 通过 `llama-cpp-2` 直接静态链接 llama.cpp | 当前固定 CPU，`n_gpu_layers = 0` | GGUF |
| iPadOS | Rust 通过 `llama-cpp-2` 直接静态链接 llama.cpp | Metal，模型层尽可能卸载到 GPU | GGUF，推荐 IQ4_XS |
| 浏览器开发模式 | 调用开发机安装的 Ollama `127.0.0.1:11434` | 由开发机 Ollama 决定 | Ollama 模型 |

Ollama 底层包含 llama.cpp/ggml 相关推理实现，但从 NSTrans 的集成层看，macOS 和 Windows 接入的是完整 Ollama 服务，并不是直接调用 llama.cpp。当前关系可以概括为：

```text
macOS / Windows -> embedded Ollama -> llama.cpp/ggml backend
Android / iPadOS -> NSTrans -> llama.cpp (llama-cpp-2)
```

模型仍只通过 `TranslationRuntime` 接口被业务层调用，因此以后将桌面端从 Ollama 改为直接 llama.cpp 时，不需要修改 OCR 管线、词库策略或翻译界面。

## 许可证与第三方项目

NSTrans 自有源码采用 [Apache License 2.0](LICENSE)。项目使用或引用了 MeikiOCR、ONNX Runtime、llama.cpp、Ollama、Tauri、React、Tesseract.js、Lucide 等开源项目，并通过用户自行下载的方式使用 TranslateGemma。完整归属、许可证及模型条款见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。第三方组件与模型仍分别受其原始许可证或使用条款约束，NSTrans 的许可证不会覆盖它们。
