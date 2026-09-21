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
$MeikiBundle = Join-Path $Build "meiki-bundle"
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

  # Hugging Face snapshots normally contain symlinks to blobs. PyInstaller
  # preserves those as links, but restoring them on a user's Windows machine
  # can require Developer Mode or elevated privileges. Build a minimal cache
  # whose snapshot entries are ordinary files so the installed OCR runtime is
  # fully self-contained and works for standard users.
  if (Test-Path $MeikiBundle) { Remove-Item -Recurse -Force $MeikiBundle }
  $BundleHub = Join-Path $MeikiBundle "huggingface\hub"
  function Copy-HuggingFaceSnapshotFile {
    param([string]$SourceRepo, [string]$DestinationRepo, [string]$FileName)
    $Revision = (Get-Content (Join-Path $SourceRepo "refs\main") -Raw).Trim()
    if (-not $Revision) { throw "Hugging Face revision is missing for $SourceRepo." }
    $SourcePath = Join-Path $SourceRepo "snapshots\$Revision\$FileName"
    $SourceItem = Get-Item $SourcePath -Force
    if ($SourceItem.LinkType) {
      $LinkTarget = @($SourceItem.Target)[0]
      $TargetPath = if ([System.IO.Path]::IsPathRooted($LinkTarget)) {
        $LinkTarget
      } else {
        Join-Path $SourceItem.DirectoryName $LinkTarget
      }
      $SourcePath = (Resolve-Path $TargetPath).Path
    }
    $DestinationSnapshot = Join-Path $DestinationRepo "snapshots\$Revision"
    New-Item -ItemType Directory -Force -Path (Join-Path $DestinationRepo "refs"), $DestinationSnapshot | Out-Null
    # huggingface_hub reads refs/main verbatim (without Trim), so Set-Content's
    # trailing newline would become part of the snapshot directory name.
    [System.IO.File]::WriteAllText((Join-Path $DestinationRepo "refs\main"), $Revision, [System.Text.Encoding]::ASCII)
    Copy-Item $SourcePath (Join-Path $DestinationSnapshot $FileName) -Force
    $Materialized = Get-Item (Join-Path $DestinationSnapshot $FileName) -Force
    if ($Materialized.LinkType -or $Materialized.Length -lt 1000000) {
      throw "MeikiOCR model was not materialized correctly: $FileName"
    }
  }

  $BundleDetect = Join-Path $BundleHub "models--rtr46--meiki.text.detect.v0"
  $BundleRecognize = Join-Path $BundleHub "models--rtr46--meiki.txt.recognition.v0"
  Copy-HuggingFaceSnapshotFile $Detect $BundleDetect "meiki.text.detect.v0.1.960x544.onnx"
  Copy-HuggingFaceSnapshotFile $Recognize $BundleRecognize "meiki.text.rec.v0.960x32.onnx"
  Copy-HuggingFaceSnapshotFile $Recognize $BundleRecognize "meiki.text.rec.v0.vertical.32x480.onnx"

  & $Python -m PyInstaller --noconfirm --clean --onefile --console `
    --name "nstrans-meiki-ocr" `
    --distpath $Runtime `
    --workpath (Join-Path $Build "pyinstaller") `
    --specpath $Build `
    --exclude-module torch `
    --exclude-module torchvision `
    --exclude-module onnxruntime.quantization `
    --add-data "${BundleHub};huggingface/hub" `
    (Join-Path $Root "native\ocr\meiki_worker.py")
}

# Do not publish an installer merely because PyInstaller produced an EXE.
# Start the frozen worker, load all bundled ONNX models offline, and process a
# valid image. This catches missing DLLs, broken cache layout and link issues on
# the same Windows runner that creates the release installer.
$SmokeRequest = & $Python -c "import base64,cv2,json,numpy as np; ok,data=cv2.imencode('.jpg',np.zeros((360,640,3),dtype=np.uint8)); print(json.dumps({'image':base64.b64encode(data).decode(),'det_threshold':0.45,'rec_threshold':0.15}))"
$PreviousErrorActionPreference = $ErrorActionPreference
try {
  # Native stderr is part of the diagnostic payload below; PowerShell must not
  # turn a single warning line into a terminating script error before the
  # worker's exit code and protocol response can be checked.
  $ErrorActionPreference = "Continue"
  $SmokeOutput = @($SmokeRequest | & $MeikiExe 2>&1)
} finally {
  $ErrorActionPreference = $PreviousErrorActionPreference
}
if ($LASTEXITCODE -ne 0) { throw "MeikiOCR frozen runtime exited with code $LASTEXITCODE`: $($SmokeOutput -join ' | ')" }
if (-not ($SmokeOutput | Where-Object { $_ -like "YOMI_READY:*" })) { throw "MeikiOCR frozen runtime did not report ready: $($SmokeOutput -join ' | ')" }
$SmokeResultLine = $SmokeOutput | Where-Object { $_ -like "YOMI_RESULT:*" } | Select-Object -Last 1
if (-not $SmokeResultLine) { throw "MeikiOCR frozen runtime returned no OCR result: $($SmokeOutput -join ' | ')" }
$SmokeResultPrefix = "YOMI_RESULT:"
$SmokeResult = ($SmokeResultLine.Substring($SmokeResultPrefix.Length) | ConvertFrom-Json)
if ($SmokeResult.error) { throw "MeikiOCR frozen runtime smoke test failed: $($SmokeResult.error)" }
Write-Host "MeikiOCR frozen runtime smoke test passed."

$OllamaLib = Join-Path $Runtime "lib\ollama"
$InstalledLlamaVersion = if (Test-Path $LlamaVersionFile) { (Get-Content $LlamaVersionFile -Raw).Trim() } else { "" }
$Cuda13Backend = Join-Path $OllamaLib "cuda_v13"
$VulkanBackend = Join-Path $OllamaLib "vulkan"
$NeedsLlamaRuntime = $Force -or -not (Test-Path $LlamaExe) -or -not (Test-Path $OllamaLib) -or -not (Test-Path $Cuda13Backend) -or -not (Test-Path $VulkanBackend) -or $InstalledLlamaVersion -ne $OllamaVersion
if (-not $NoLlama -and $NeedsLlamaRuntime) {
  $Archive = Join-Path $Build "ollama-windows-amd64.zip"
  $Extracted = Join-Path $Build "ollama"
  $Base = if ($OllamaVersion) { "https://github.com/ollama/ollama/releases/download/v$OllamaVersion" } else { "https://github.com/ollama/ollama/releases/latest/download" }
  $ArchiveUrl = "$Base/ollama-windows-amd64.zip"
  Write-Host "Downloading Ollama $OllamaVersion runtime (this archive is large and may take 30-40 minutes on a GitHub runner)..."
  # Invoke-WebRequest does not emit useful transfer progress in GitHub Actions,
  # making this step appear frozen. curl.exe reports live progress and retries
  # transient CDN failures; speed-time also prevents a genuinely stalled
  # connection from occupying the runner indefinitely.
  & curl.exe --fail --location --retry 4 --retry-all-errors --connect-timeout 30 `
    --speed-limit 1024 --speed-time 180 --progress-bar `
    --output $Archive $ArchiveUrl
  if ($LASTEXITCODE -ne 0) { throw "Ollama runtime download failed with curl exit code $LASTEXITCODE." }
  $ArchiveBytes = (Get-Item $Archive).Length
  if ($ArchiveBytes -lt 100000000) { throw "Downloaded Ollama archive is unexpectedly small: $ArchiveBytes bytes." }
  Write-Host "Ollama archive downloaded: $([math]::Round($ArchiveBytes / 1MB, 1)) MiB. Extracting..."
  if (Test-Path $Extracted) { Remove-Item -Recurse -Force $Extracted }
  Expand-Archive -Path $Archive -DestinationPath $Extracted
  Write-Host "Ollama archive extraction completed. Validating bundled backends..."
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
  Write-Host "Copying Ollama CPU, CUDA 13 and Vulkan runtimes into the application bundle..."
  Copy-Item $DownloadedLib (Join-Path $Runtime "lib") -Recurse -Force
  Set-Content -Path $LlamaVersionFile -Value $OllamaVersion -Encoding ascii
  Write-Host "Ollama runtime $OllamaVersion is ready."
}

if (-not (Test-Path $MeikiExe) -or (-not $NoLlama -and (-not (Test-Path $LlamaExe) -or -not (Test-Path $OllamaLib)))) {
  throw "Windows runtime validation failed."
}
$RuntimeBytes = (Get-ChildItem $Runtime -File -Recurse | Measure-Object -Property Length -Sum).Sum
if (-not $NoLlama -and $RuntimeBytes -ge 1900000000) {
  throw "Windows runtime is $RuntimeBytes bytes and is too large for the 2 GiB NSIS data-block limit."
}
Write-Host "Windows runtime ready: $Runtime"
