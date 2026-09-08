param(
  [string]$OllamaVersion = "",
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
if (-not $NoLlama -and ($Force -or -not (Test-Path $LlamaExe) -or -not (Test-Path $OllamaLib))) {
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
  if (Test-Path (Join-Path $Runtime "lib")) { Remove-Item -Recurse -Force (Join-Path $Runtime "lib") }
  Copy-Item $DownloadedLib (Join-Path $Runtime "lib") -Recurse -Force
}

if (-not (Test-Path $MeikiExe) -or (-not $NoLlama -and (-not (Test-Path $LlamaExe) -or -not (Test-Path $OllamaLib)))) {
  throw "Windows runtime validation failed."
}
Write-Host "Windows runtime ready: $Runtime"
