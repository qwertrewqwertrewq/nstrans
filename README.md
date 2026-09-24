# NSTrans

[![CI](https://github.com/qwertrewqwertrewq/nstrans/actions/workflows/ci.yml/badge.svg)](https://github.com/qwertrewqwertrewq/nstrans/actions/workflows/ci.yml)

面向 macOS、Windows、Android 与 iPadOS 的实时日文 OCR 与翻译覆盖工具。业务界面与平台原生能力分层，桌面端均可离线运行 OCR 与翻译模型。

## 平台实测状态(主要指本地翻译模型测试)

| 平台 | 测试设备 | 当前状态 |
|---|---|---|
| macOS | Apple M4、16GB RAM | 运行良好；MeikiOCR 为默认引擎，也可切换 Apple Vision |
| iPadOS | Apple M2、8GB RAM | 使用 TranslateGemma 4B IQ4_XS，运行效果尚可；当前提供未签名 IPA，需用户使用自己的证书自签 |
| Android | Snapdragon 750G、8GB RAM、Android 11 | 已完成 arm64 APK、原生 USB 采集卡、MeikiOCR 与 llama.cpp 接入；现有设备只验证应用可启动，尚无足够性能完成实际翻译效果与长期稳定性验证 |
| Windows | Windows 10/11 x64 | 使用i7-12700KF RTX 4070 32G RAM，CUDA、Vulkan及CPU模式均运行良好|

以上结论只代表列出的设备和当前 Alpha 构建，不构成对其他硬件性能、稳定性或兼容性的保证。

## 隐私与版权边界

- 视频画面、截图和完整 OCR 识别文本不会上传至 NSTrans 社区服务器，服务器也不保存用户截取画面中的对白、剧情文本或画面内容。选择远程 LLM 或网页机翻时，待翻译 OCR 文本会直接发送给用户选择的对应服务；选择本机 TranslateGemma 或 NLLB 时则留在设备内。用户主动开启“远程视觉识别”时，只有搜索链全部为空的当前文字局部截图、该区域 OCR 文本和游戏名称会直接发送给用户配置的远程多模态模型；该开关默认关闭。
- 客户端本机只会为复用翻译而缓存符合限制的专有名词、单词和短菜单标签；不会建立视频、截图或长篇游戏文本档案。用户可以通过清除应用数据移除这些本地缓存。
- “共享本地词库贡献”默认关闭。开启后仍只允许上传经过长度、结构和标点过滤的专有名词、单词与短句，不允许上传对白、描述或连续剧情文本。
- 自动学习的专业词汇来自 Wikipedia、Wikidata 或用户配置的搜索服务，并保存来源链接；搜索候选只作为模型术语提示，不会把网页内容复制进游戏文本库。
- NSTrans 不包含、托管或授权任何游戏画面、剧情文本、商标或其他游戏资产。相关权利归各自权利人所有；本项目与任天堂及其他游戏发行商、开发商无隶属或背书关系。

## 当前能力

- 枚举并打开 USB 采集卡/摄像头；桌面端使用系统媒体设备，Android 与 iPadOS 还包含原生 USB/UVC 输入桥接
- 桌面端一体化预览与控制面板，移动端默认全屏预览；支持全窗口、系统全屏、暂停画面、框选 OCR 区域及悬浮工具栏
- macOS 默认使用 Apache-2.0 的 MeikiOCR 游戏日文模型并可切换 Apple Vision；Windows 与 Android 使用 MeikiOCR；iPadOS 只使用 Apple Vision
- Switch 游戏策略会合并连续文字、抑制假名注音碎片和孤立按键图标，并保留可信的小字号说明与底部按键提示词
- 基于文字包围框模糊原文并覆盖译文；长译文滚动显示时锁定近似区域，避免重复翻译和覆盖层跳动
- 分别显示采集、OCR、翻译、渲染和端到端延迟
- 内置带时间戳的运行日志，记录 OCR 模型启动、识别数量、词库命中、专名搜索和 LLM 请求/响应
- 可发现同一局域网内的 NSTrans TV 客户端，也可按 IP 握手连接；支持传输透明 PNG 字幕层或带坐标、字体与滚动参数的文本字幕
- 翻译方式可在“词库、缓存与学习辅助”和“OCR 原文直送核心翻译”之间切换；直送模式不匹配翻译词库/缓存、不执行术语搜索或学习入库，但仍可启用远程视觉识别
- 核心翻译可独立选择本机 TranslateGemma 4B、远程 LLM 或机器翻译。`WithLlama` 还提供按需下载的本机 NLLB-200 Distilled 600M；所有构建都可使用无需 API Key 的网易有道、Google、Bing、DeepL 网页机翻
- 远程核心模型可从所有在线模型配置中选择；多模态模型和仅搜索能力模型都可用于纯文本核心翻译，但仅多模态模型能接收 OCR 原文本及局部截图，离线模型配置暂不参与路由
- 同一帧长文本批量送入同一上下文；持续游戏对白会复用上下文，默认 45 秒无长文后自动开始新对话，也可手动重置
- 客户端启动时从 `nstrans.221129.xyz` 同步通用词库和当前游戏词库，并保留本地缓存；游戏词库优先于通用词库匹配
- 未知片假名专名可选择 Wikipedia/Wikidata、Brave Search、百度千帆、Qwen模型联网搜索、用户自定义远程模型作为搜索服务，并可另选一个无结果时的回退服务；除 Wiki 外均使用用户自己的 API Key
- 用户可选择是否向社区服务器共享本机产生的专名、单词和短标签；默认关闭，上传内容还会经过长度、结构和标点过滤
- Tauri 2 共用壳层，配合 macOS/iPadOS Apple 原生能力、Android JNI/Kotlin 桥接及 Windows 原生运行时

使用词库辅助方式时，开启“在线学习专有名词”后，仅当前游戏名称和抽取出的候选专名会发送到用户选择的搜索服务；普通对白和完整 OCR 文本不会上传。使用 OCR 原文直送方式时，OCR 文字会发送给所选核心模型，但不进入词库、搜索或学习流程。另行开启远程视觉模型后，系统可裁剪当前 OCR 包围框连同本地 OCR 结果和游戏信息发送给所选多模态模型；直送模式下的 OCR 识别果只在当前会话短期复用，不写入学习词库。

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

macOS 提供两种构建。完整版包含桌面本地推理运行时；远程版不包含本地 llama/Ollama 运行时，只能选择远程核心 LLM，但仍保留 MeikiOCR、Apple Vision 和其他客户端功能：

```bash
npm run desktop:build:full
npm run desktop:build:remote
```

产物位于：

```text
src-tauri/target/release/bundle/macos/NSTrans.app
src-tauri/target/release/bundle/dmg/NSTrans_0.1.1_aarch64.dmg
src-tauri/target/release/bundle/dmg/NSTrans_0.1.1_aarch64_remote-only.dmg
```

macOS 客户端内置 Ollama 运行时并自行管理 TranslateGemma 4B（首次运行下载约 3.3GB）。NSTrans 会在本机回环地址启动隔离的 Ollama 服务，不依赖用户另行安装或启动 Ollama；MeikiOCR 与 ONNX 权重随应用分发并作为默认 OCR，Apple Vision 可由用户手动选择，并在 MeikiOCR 不可用时作为回退。所选 OCR 引擎会保存到本机。最终用户无需安装 Python 或启动外部模型服务。

## iPadOS 构建

iPadOS 只使用 Apple Vision OCR。默认构建无签名 IPA，方便用户使用自己的开发证书自签；需要 Xcode 16、Rust iOS target 和 Tauri iOS 工程：

```bash
rustup target add aarch64-apple-ios
npm run ios:build:with-llama
npm run ios:build:remote
```

`WithLlama` 会静态编译移动端 llama.cpp，允许导入 IQ4_XS GGUF，并包含 NLLB 的 ONNX/WASM 运行能力；`RemoteOnly` 不编译 llama.cpp、不包含 NLLB 运行时，但仍可使用远程 LLM 或网页机翻，因而安装包和运行内存压力更小。两个命令的原始产物都位于 `src-tauri/gen/apple/build/arm64/NSTrans.ipa`，连续构建时后一个会覆盖前一个；GitHub Actions 会分别复制并标名。如果构建机已配置开发团队并希望让 Xcode 正常签名和导出，可设置 `NSTRANS_IOS_ALLOW_SIGNING=1` 后构建。

## Android 构建

Android 当前只提供 arm64 调试签名测试包，需要 Android SDK、NDK、Java 17 与 Rust Android target：

```bash
rustup target add aarch64-linux-android
npm run android:build:with-llama
npm run android:build:remote
```

`WithLlama` 静态编译移动端 llama.cpp，并包含 NLLB 的 ONNX/WASM 运行能力；`RemoteOnly` 完全省略本地 llama 和 NLLB，改用远程 LLM 或网页机翻。原始产物位于 `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`，连续构建时后一个会覆盖前一个；GitHub Actions 会分别复制并标名。该包只用于兼容性测试，不应视为经过发布签名的正式版本。

## Android TV / 投影仪字幕客户端

[`androidscreenclient`](./androidscreenclient) 是独立的 Android 6+ 电视接收端，不负责 OCR 和翻译。默认字幕只在应用内显示，不要求悬浮窗权限；用户主动启用并完成系统授权后，才会启动前台接收服务和系统悬浮层，切换到厂商自带 HDMI 应用也能继续显示字幕。

```bash
cd androidscreenclient
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

电视端使用 UDP `38472` 自动广播，字幕服务监听 TCP `38471`。自动发现被路由器的 AP 隔离阻止时，可在 NSTrans 的“输入源与实时控制”卡片直接填写电视 IP。文本模式保留电视端滚动能力；图片模式更接近本机布局，并会在传输期间隐藏本机字幕层。详细协议及设备限制见 [`androidscreenclient/README.md`](./androidscreenclient/README.md)。

## Windows 构建

Windows x64 客户端只使用 MeikiOCR，不加载 Apple Vision 或 Tesseract 回退。TranslateGemma 使用随应用分发的 Ollama 运行时，用户可在控制台选择 Ollama 的 CUDA、Vulkan 或 CPU 推理后端；选择会保存在本机并在切换后重启模型进程。WithLlama 安装包内置 CPU、Vulkan 与 CUDA 13 后端；旧版 NVIDIA 驱动无法使用 CUDA 13 时应选择 Vulkan，或更新显卡驱动。MeikiOCR、模型管理、三种后端选择和 NSIS 打包均已完成接入。

Windows 同样提供完整版和不打包本地 llama/Ollama 的远程版：

```powershell
npm run windows:build:full
npm run windows:build:remote
```

构建机需要 Windows 10/11 x64、Node.js 20+、Rust stable、Visual Studio 2022 C++ Build Tools、WebView2，以及 Python 3.11。首次执行会下载官方 Windows Ollama 独立运行包，并把 MeikiOCR 工作进程及其 ONNX 权重打包成离线 EXE；TranslateGemma 权重不放入安装包，由客户端首次运行时下载或由用户导入：

```powershell
npm install
npm run windows:runtime
npm run windows:build
```

生成的 NSIS 安装程序位于：

```text
src-tauri\target\release\bundle\nsis\NSTrans_0.1.1_x64-setup.exe
```

## TranslateGemma 4B 默认模型、来源与兼容限制

Google 官方原始模型仓库是 [`google/translategemma-4b-it`](https://huggingface.co/google/translategemma-4b-it)，提供 Transformers/Safetensors 权重且需要接受 Gemma 使用条款；它不是 NSTrans 移动端直接加载的 GGUF。各平台使用相同的 TranslateGemma 4B 基础模型，但运行时、量化文件、发布方和内存需求不同，不能把“模型名称相同”理解为模型文件可以任意互换：

| 平台 | NSTrans 默认下载/模型 | 来源性质 | 大小参考 | 当前验证情况 |
|---|---|---|---:|---|
| macOS | NSTrans R2 镜像，Q4_K_M | 上游为 Ollama Library `translategemma:4b`；不是 Google 原始 Safetensors | 3.30GB | Apple M4、16GB RAM 运行良好 |
| Windows | NSTrans R2 镜像，Q4_K_M | 与 macOS 共用同一个 Ollama 模型对象 | 3.30GB | 三种后端在测试机上均运行良好 |
| iPadOS | NSTrans R2 镜像，IQ4_XS | 上游为 `mradermacher/translategemma-4b-it-GGUF` 社区转换/量化 | 2.28GB | Apple M2、8GB RAM 实测可用，效果尚可 |
| Android | NSTrans R2 镜像，Q4_K_M | 上游为 `Qwe1325/translategemma-4b-it-GGUF` 社区转换/量化 | 2.49GB | 受测试设备性能限制，尚未完成实际翻译验证 |

客户端的默认模型下载也直接使用社区站提供的 Cloudflare R2 镜像，并显示已下载容量、总容量、百分比以及校验/导入阶段。[下载页面](https://nstrans.221129.xyz/download)按 macOS、Windows、iPadOS、Android 分别给出入口；macOS 与 Windows 共用同一个对象，不重复占用存储。下载或使用模型需同意 [Gemma Terms of Use](https://ai.google.dev/gemma/terms)，模型权重不适用本仓库的 Apache-2.0 许可证。

`RemoteOnly` 构建在所有平台均没有本地 TranslateGemma 或 NLLB 运行时，也不会自动下载上述权重；它可以使用用户配置的远程 API 或网页机翻。`WithLlama` 只表示包含本地运行能力，不表示安装包内附带模型权重。

## NLLB 与网页机器翻译

`WithLlama` 构建可在“机器翻译”中选择 `NLLB-200 Distilled 600M`。Transformers.js、ONNX Runtime Web 与 WASM 推理文件随 WithLlama 应用分发；首次启用时，客户端从 NSTrans Worker 下载一个固定版本的 Q8 ONNX ZIP（约 874 MiB），校验整体 SHA-256 后由原生层流式解压到应用数据目录，后续完全离线复用。推理 Worker 通过本机回环只读服务加载已安装文件，不会再将约 900MB 模型复制进 WebView 缓存。RemoteOnly 构建不会携带 Transformers.js、ONNX WASM 或 NLLB Worker。模型不会硬塞进安装包，其推理内存仍明显高于“600M”这个参数量名称，移动设备需预留足够存储与内存。该模型及兼容 ONNX 权重采用 **CC BY-NC 4.0**，不受本仓库 Apache-2.0 许可证覆盖，商业用途应另行评估许可。

所有构建还可选择网易有道、Google、Bing 或 DeepL 网页机翻。客户端后端只负责访问公开网页协议，TypeScript 层完成结果解析与最多三路的受控并发；没有复制团子翻译器源码，也没有使用需要密钥的私有翻译 API。团子公开旧版列出的百度、腾讯、彩云和小牛现已需要网页验证码、登录态或 API 凭据，因此没有伪装成匿名可用选项。这个通道受网页结构、服务条款、访问频率限制和地区网络影响，服务方页面调整后可能临时失效，不应当作稳定性等同正式 API 的接口。实测方法与结果见 [`docs/machine-translation-benchmark.md`](docs/machine-translation-benchmark.md)。

2026-09-24 在 Apple M4、16GB RAM 的 MacBook Air 上进行的单次端到端实测摘要如下（网页服务结果受出口网络与限流影响，不代表 SLA）：

| 翻译服务 | 普通单句 | 四句并行/批处理 | 长句 | 结果摘要 |
| --- | ---: | ---: | ---: | --- |
| 网易有道网页 | 229 ms | 262 ms | 147 ms | 三组成功 |
| Google 网页 | 343 ms | 521 ms | 536 ms | 单句成功，后续请求出现 HTTP 429 |
| Bing 网页 | 296 ms | 286 ms | 204 ms | 当前出口触发网页验证，未取得译文 |
| DeepL 网页 | 2,421 ms | 1,143 ms | 439 ms | 单句成功，并发触发 HTTP 429 |
| 本机 NLLB-600M Q8 | 686 ms | 817 ms | 2,785 ms | 热运行三组成功；冷加载另需 2,126 ms |

NLLB 的长句结果在本次测试中遗漏末段，更适合短字幕而非长段落。表中失败耗时表示服务返回验证或限流错误所需时间，不应误读为成功翻译延迟；完整译文、测试方法和限制见上述基准文档。

移动端直接使用 `llama-cpp-2`，必须选择与当前 llama.cpp Gemma 3 文本加载器兼容的、完整的 TranslateGemma 文本 GGUF。以下文件不能直接使用：

- Ollama 模型仓库中的组合 blob。它可能同时包含文本与视觉张量，Ollama 能加载，但上游 llama.cpp 通常要求视觉投影器独立提供。
- 单独的 `mmproj` 视觉投影文件、Transformers 原始权重、拆分但尚未合并的 GGUF，以及其他 Gemma/TranslateGemma 参数规模的模型。
- 只因为扩展名为 `.gguf` 就假定兼容的第三方文件。客户端的初步检查只能确认文件大小和 GGUF 文件头，真正加载时仍可能因架构、张量、元数据或内存不足而失败。

Android 之前出现过 `NullResult`/模型加载失败，原因范围包括误用 Ollama 组合 blob、不兼容 GGUF、缺少 Gemma 3 元数据、张量不匹配和内存分配失败。当前代码改用面向 llama.cpp 的文本 GGUF，并补充 `gemma3.attention.layer_norm_rms_epsilon` 参数覆盖，但这不能保证任意第三方量化都兼容。排查移动端加载问题时必须查看 Android logcat 或 Xcode 设备日志；顶层 `NullResult` 本身不会保留底层具体原因。

模型文件大小也不等于运行时 RAM 占用。除权重外还需要 KV cache、计算图、图像/OCR 缓冲区和系统内存。8GB iPad 使用 IQ4_XS 已经实测；8GB Android 是否能稳定运行 Q4_K_M 取决于系统可用内存、厂商限制和 CPU 性能，当前不作可用性保证。

## 验证

```bash
npm run test
npm run lint
npm run build
```

## GitHub Actions 自动构建

`.github/workflows/ci.yml` 会在 `main` 的提交和拉取请求上执行测试、Lint 与前端构建。`.github/workflows/platform-builds.yml` 会在每次推送到 `main` 后并行构建 macOS、Windows、iPadOS、Android；每个平台均上传两个名称明确的 Actions Artifact：`WithLlama`（包含 TranslateGemma 与 NLLB 本地运行能力）与 `RemoteOnly`（不包含本地模型运行时，可使用远程 LLM 或网页机翻）。也可以从 Actions 页面手动触发该工作流。

推送 `v*` 标签会触发 `.github/workflows/release.yml`，为四个平台同时生成 `WithLlama` 与 `RemoteOnly` 两套带校验和的安装包，然后使用仓库自动提供的 `GITHUB_TOKEN` 直接上传到对应 GitHub Release：

```bash
git tag v0.1.1
git push myrepo v0.1.1
```

也可以在 GitHub 的 Actions 页面手动运行 “Cross-platform release”，填写一个已经存在并包含该工作流的标签。工作流默认创建或沿用预发布版本，不需要保存 Apple 证书、Android keystore 或个人访问令牌。当前 iPadOS 产物由用户自行签名，Android 产物是调试签名；如需正式发行签名，需要另外通过 GitHub Environments 配置证书和密钥。

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
  services/translationRuntime.ts LLM、NLLB 与网页机翻运行时接口
  services/webMachineTranslation.ts 网页机翻 HTML 解析与跨平台请求适配
  workers/nllb.worker.ts         NLLB ONNX 推理工作线程
  gameAdapters/registry.ts       仅包含可选择的游戏类别元数据
  App.tsx                       采集、管线调度、覆盖层与控制台
native/translation/             旧模型迁移文件（当前运行路径不加载）
src-tauri/                macOS、Windows、Android 与 iPadOS 共用原生壳层及平台桥接
tools/testing/            摄像头枚举、权限检查和虚拟视频源等开发测试工具
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
