param(
  [string]$OllamaVersion = "0.33.3",
  [switch]$Force,
  [switch]$NoLlama
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "Windows runtime must be prepared on Windows x64." }

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root "native\runtime\windows"
$Build = Join-Path $Root ".build\windows"
$Venv = Join-Path $Build "venv"
$Python = Join-Path $Venv "Scripts\python.exe"
$MeikiExe = Join-Path $Runtime "nstrans-meiki-ocr.exe"
$LlamaExe = Join-Path $Runtime "nstrans-llama.exe"
$LlamaVersionFile = Join-Path $Runtime "ollama-version.txt"
New-Item -ItemType Directory -Force -Path $Runtime, $Build | Out-Null

if ($Force -or -not (Test-Path $MeikiExe)) {
  $PythonLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($PythonLauncher) { & py -3.11 -m venv $Venv } else { & python -m venv $Venv }
  & $Python -m pip install --upgrade pip
  & $Python -m pip install meikiocr pyinstaller

  $env:HF_HOME = Join-Path $Build "huggingface"
  $env:HF_HUB_OFFLINE = "0"
  & $Python -c "from meikiocr import MeikiOCR; MeikiOCR(); print('MeikiOCR models cached')"
  $Hub = Join-Path $env:HF_HOME "hub"
  $Detect = Join-Path $Hub "models--rtr46--meiki.text.detect.v0"
  $Recognize = Join-Path $Hub "models--rtr46--meiki.txt.recognition.v0"
  if (-not (Test-Path $Detect) -or -not (Test-Path $Recognize)) { throw "MeikiOCR model cache is incomplete." }

  & $Python -m PyInstaller --noconfirm --clean --onefile --console `
    --name "nstrans-meiki-ocr" `
    --distpath $Runtime `
    --workpath (Join-Path $Build "pyinstaller") `
    --specpath $Build `
    --exclude-module torch `
    --exclude-module torchvision `
    --exclude-module onnxruntime.quantization `
    --add-data "${Detect};huggingface/hub/models--rtr46--meiki.text.detect.v0" `
    --add-data "${Recognize};huggingface/hub/models--rtr46--meiki.txt.recognition.v0" `
    (Join-Path $Root "native\ocr\meiki_worker.py")
}

$OllamaLib = Join-Path $Runtime "lib\ollama"
$InstalledLlamaVersion = if (Test-Path $LlamaVersionFile) { (Get-Content $LlamaVersionFile -Raw).Trim() } else { "" }
$Cuda13Backend = Join-Path $OllamaLib "cuda_v13"
$VulkanBackend = Join-Path $OllamaLib "vulkan"
$NeedsLlamaRuntime = $Force -or -not (Test-Path $LlamaExe) -or -not (Test-Path $OllamaLib) -or -not (Test-Path $Cuda13Backend) -or -not (Test-Path $VulkanBackend) -or $InstalledLlamaVersion -ne $OllamaVersion
if (-not $NoLlama -and $NeedsLlamaRuntime) {
  $Archive = Join-Path $Build "ollama-windows-amd64.zip"
  $Extracted = Join-Path $Build "ollama"
  $Base = if ($OllamaVersion) { "https://github.com/ollama/ollama/releases/download/v$OllamaVersion" } else { "https://github.com/ollama/ollama/releases/latest/download" }
  Invoke-WebRequest -Uri "$Base/ollama-windows-amd64.zip" -OutFile $Archive
  if (Test-Path $Extracted) { Remove-Item -Recurse -Force $Extracted }
  Expand-Archive -Path $Archive -DestinationPath $Extracted
  $DownloadedExe = Get-ChildItem $Extracted -Filter "ollama.exe" -Recurse | Select-Object -First 1
  if (-not $DownloadedExe) { throw "ollama.exe is missing from the standalone archive." }
  Copy-Item $DownloadedExe.FullName $LlamaExe -Force
  $DownloadedLib = Join-Path $DownloadedExe.Directory.FullName "lib"
  if (-not (Test-Path $DownloadedLib)) { throw "Ollama GPU runtime libraries are missing from the standalone archive." }

  # NSIS cannot create installers whose data block reaches 2 GiB. Current
  # Ollama archives ship two complete CUDA generations; keep CUDA 13 plus
  # Vulkan and CPU so the bundled runtime remains installable. Vulkan is also
  # the fallback for NVIDIA cards whose driver cannot use the CUDA 13 backend.
  $Cuda12 = Join-Path $DownloadedLib "ollama\cuda_v12"
  if (Test-Path $Cuda12) { Remove-Item -Recurse -Force $Cuda12 }
  foreach ($RequiredBackend in @("ollama\cuda_v13", "ollama\vulkan")) {
    if (-not (Test-Path (Join-Path $DownloadedLib $RequiredBackend))) {
      throw "Ollama $RequiredBackend backend is missing from the standalone archive."
    }
  }

  if (Test-Path (Join-Path $Runtime "lib")) { Remove-Item -Recurse -Force (Join-Path $Runtime "lib") }
  Copy-Item $DownloadedLib (Join-Path $Runtime "lib") -Recurse -Force
  Set-Content -Path $LlamaVersionFile -Value $OllamaVersion -Encoding ascii
}

if (-not (Test-Path $MeikiExe) -or (-not $NoLlama -and (-not (Test-Path $LlamaExe) -or -not (Test-Path $OllamaLib)))) {
  throw "Windows runtime validation failed."
}
$RuntimeBytes = (Get-ChildItem $Runtime -File -Recurse | Measure-Object -Property Length -Sum).Sum
if (-not $NoLlama -and $RuntimeBytes -ge 1900000000) {
  throw "Windows runtime is $RuntimeBytes bytes and is too large for the 2 GiB NSIS data-block limit."
}
Write-Host "Windows runtime ready: $Runtime"
