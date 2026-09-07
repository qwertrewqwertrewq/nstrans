# Third-party notices

NSTrans 自有源码采用 Apache License 2.0。以下项目、运行时和模型不因被 NSTrans 调用、链接或打包而改变其原始许可证。发行构建者有责任同时遵守对应条款。

| 项目 | 用途 | 许可证/条款 | 上游项目 |
|---|---|---|---|
| MeikiOCR 及其公开模型 | 游戏日文文字检测与识别 | Apache-2.0 | https://github.com/rtr46/meikiocr |
| ONNX Runtime | MeikiOCR ONNX 推理 | MIT | https://github.com/microsoft/onnxruntime |
| llama.cpp / llama-cpp-2 | Android、iPadOS 与桌面 GGUF 推理 | MIT | https://github.com/ggml-org/llama.cpp |
| Ollama CLI/runtime | Windows 与部分桌面模型运行时 | MIT；仅指开源仓库中的 CLI/runtime 代码 | https://github.com/ollama/ollama |
| TranslateGemma | 日文到中文翻译模型 | Gemma Terms of Use；不是 Apache-2.0 或 MIT | https://huggingface.co/google/translategemma-4b-it |
| Tauri | 跨平台应用壳层 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| React / React DOM | 客户端界面 | MIT | https://github.com/facebook/react |
| Tesseract.js | 浏览器开发回退与历史兼容代码 | Apache-2.0 | https://github.com/naptha/tesseract.js |
| Lucide | 界面图标 | ISC | https://github.com/lucide-icons/lucide |
| Wikimedia APIs | 公开专有名词检索来源 | 各页面内容适用 Wikimedia 标注的许可与归属要求 | https://www.mediawiki.org/wiki/API:Main_page |

TranslateGemma 模型权重不属于 NSTrans 源码。用户下载、导入和使用模型前应阅读并接受 Google Gemma 使用条款。游戏名称、商标、画面、文本与其他资产属于各自权利人；NSTrans 未主张其所有权。

JavaScript、Rust、Python、Gradle 和平台 SDK 的传递依赖还包含各自的许可证文本。重新发行二进制文件时，应保留构建产物随附的许可证与通知，并以锁文件中的实际版本为准。
