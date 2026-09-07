#!/bin/sh
set -eu

ollama_version="${1:-${NSTRANS_OLLAMA_VERSION:-0.12.3}}"
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
project_dir="$(dirname -- "$script_dir")"
runtime_dir="$project_dir/native/runtime/macos"
build_dir="$project_dir/.build/macos"
python_bin="${PYTHON:-python3}"
meiki_bin="$runtime_dir/nstrans-meiki-ocr"
llama_bin="$runtime_dir/nstrans-llama"

mkdir -p "$runtime_dir" "$build_dir"

if [ ! -x "$meiki_bin" ]; then
  venv_dir="$build_dir/venv"
  "$python_bin" -m venv "$venv_dir"
  python_bin="$venv_dir/bin/python"
  "$python_bin" -m pip install --upgrade pip
  "$python_bin" -m pip install meikiocr pyinstaller

  export HF_HOME="$build_dir/huggingface"
  export HF_HUB_OFFLINE=0
  "$python_bin" -c "from meikiocr import MeikiOCR; MeikiOCR(); print('MeikiOCR models cached')"

  detect_dir="$HF_HOME/hub/models--rtr46--meiki.text.detect.v0"
  recognize_dir="$HF_HOME/hub/models--rtr46--meiki.txt.recognition.v0"
  if [ ! -d "$detect_dir" ] || [ ! -d "$recognize_dir" ]; then
    echo "MeikiOCR model cache is incomplete." >&2
    exit 1
  fi

  "$python_bin" -m PyInstaller --noconfirm --clean --onefile --console \
    --name nstrans-meiki-ocr \
    --distpath "$runtime_dir" \
    --workpath "$build_dir/pyinstaller" \
    --specpath "$build_dir" \
    --exclude-module torch \
    --exclude-module torchvision \
    --exclude-module onnxruntime.quantization \
    --add-data "$detect_dir:huggingface/hub/models--rtr46--meiki.text.detect.v0" \
    --add-data "$recognize_dir:huggingface/hub/models--rtr46--meiki.txt.recognition.v0" \
    "$project_dir/native/ocr/meiki_worker.py"
fi

if [ ! -x "$llama_bin" ]; then
  ollama_archive="$build_dir/ollama-darwin.tgz"
  ollama_extract="$build_dir/ollama"
  curl --fail --location --retry 3 \
    "https://github.com/ollama/ollama/releases/download/v${ollama_version}/ollama-darwin.tgz" \
    --output "$ollama_archive"
  rm -rf "$ollama_extract"
  mkdir -p "$ollama_extract"
  tar -xzf "$ollama_archive" -C "$ollama_extract"
  downloaded_bin="$(find "$ollama_extract" -type f -name ollama -perm -111 | head -n 1)"
  if [ -z "$downloaded_bin" ]; then
    echo "Ollama executable is missing from ollama-darwin.tgz." >&2
    exit 1
  fi
  cp "$downloaded_bin" "$llama_bin"
  chmod 755 "$llama_bin"
fi

test -x "$meiki_bin"
test -x "$llama_bin"
echo "macOS runtimes ready: $runtime_dir"
