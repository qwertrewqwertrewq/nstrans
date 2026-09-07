# Windows runtime payload

This directory is populated on a Windows x64 build machine by:

```powershell
npm run windows:runtime
```

The generated, platform-specific binaries are intentionally not committed:

- `nstrans-meiki-ocr.exe`: offline MeikiOCR PyInstaller worker
- `nstrans-llama.exe`: embedded Ollama/llama.cpp runner
- `lib/ollama/*`: CPU, CUDA and Vulkan runtime libraries
