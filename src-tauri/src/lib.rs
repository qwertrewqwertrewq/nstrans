use serde::{Deserialize, Serialize};
use std::{io::{BufRead, BufReader, Write}, process::{Child, ChildStdin, ChildStdout, Command, Stdio}, sync::{Arc, Mutex}, time::Duration};
use tauri::{path::BaseDirectory, AppHandle, Manager, State};

#[cfg(target_os = "android")]
mod android_runtime;
#[cfg(any(target_os = "android", target_os = "ios"))]
mod android_llm;
#[cfg(target_os = "ios")]
mod ios_bridge;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

const LLAMA_ORIGIN: &str = "http://127.0.0.1:11435";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus { available: bool, error: Option<String> }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlamaBackendStatus { backend: String }

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelPickerResult { available: bool, cancelled: bool, error: Option<String> }

#[tauri::command]
fn client_platform() -> &'static str {
  if cfg!(target_os = "ios") { "ios" }
  else if cfg!(target_os = "android") { "android" }
  else if cfg!(target_os = "macos") { "macos" }
  else if cfg!(target_os = "windows") { "windows" }
  else { "other" }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedTranslation { translation: String }

#[derive(Debug, Serialize)]
struct EntitySearchHit { title: String, url: String, snippet: String }

#[derive(Debug, Deserialize)]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct LlamaTags { models: Option<Vec<LlamaModel>> }

#[derive(Debug, Deserialize)]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct LlamaModel { name: String }

#[derive(Debug, Deserialize)]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct LlamaChatResponse { message: Option<LlamaMessage>, error: Option<String> }

#[derive(Debug, Deserialize)]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct LlamaMessage { content: String }

#[derive(Clone)]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct LlamaState(Arc<Mutex<Option<Child>>>);

#[derive(Clone)]
#[cfg(any(target_os = "android", target_os = "ios"))]
struct LlamaState(Arc<Mutex<android_llm::MobileLlm>>);

fn isolate_process(command: &mut Command) {
  #[cfg(unix)]
  { command.process_group(0); }
}

fn terminate_process(child: &mut Child) {
  #[cfg(unix)]
  unsafe { libc::kill(-(child.id() as i32), libc::SIGTERM); }
  #[cfg(not(unix))]
  { let _ = child.kill(); }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl Drop for LlamaState {
  fn drop(&mut self) {
    if let Ok(mut guard) = self.0.lock() {
      if let Some(child) = guard.as_mut() { terminate_process(child); }
    }
  }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn llama_binary(app: &AppHandle) -> Result<std::path::PathBuf, String> {
  if cfg!(debug_assertions) {
    let relative = if cfg!(target_os = "windows") { "../native/runtime/windows/nstrans-llama.exe" } else { "../native/runtime/macos/nstrans-llama" };
    Ok(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative))
  } else {
    let relative = if cfg!(target_os = "windows") { "runtime/nstrans-llama.exe" } else { "runtime/nstrans-llama" };
    app.path().resolve(relative, BaseDirectory::Resource).map_err(|error| error.to_string())
  }
}

#[cfg(target_os = "windows")]
fn llama_backend_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
  let directory = app.path().app_config_dir().map_err(|error| error.to_string())?;
  std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
  Ok(directory.join("llama-backend"))
}

#[cfg(target_os = "windows")]
fn selected_llama_backend(app: &AppHandle) -> String {
  llama_backend_path(app).ok().and_then(|path| std::fs::read_to_string(path).ok()).map(|value| value.trim().to_lowercase()).filter(|value| matches!(value.as_str(), "cuda" | "vulkan" | "cpu")).unwrap_or_else(|| "cpu".into())
}

#[cfg(target_os = "windows")]
fn configure_llama_backend(app: &AppHandle, command: &mut Command) {
  match selected_llama_backend(app).as_str() {
    "cuda" => {
      // CUDA library names include a version suffix and change across Ollama
      // releases. Disable competing backends and retain CUDA autodetection.
      command.env_remove("OLLAMA_LLM_LIBRARY").env("OLLAMA_VULKAN", "0").env("HIP_VISIBLE_DEVICES", "-1").env("ROCR_VISIBLE_DEVICES", "-1");
    },
    "vulkan" => {
      command.env("OLLAMA_LLM_LIBRARY", "vulkan").env("OLLAMA_VULKAN", "1").env("CUDA_VISIBLE_DEVICES", "-1").env("HIP_VISIBLE_DEVICES", "-1").env("ROCR_VISIBLE_DEVICES", "-1");
    },
    _ => {
      command.env("OLLAMA_LLM_LIBRARY", "cpu").env("OLLAMA_VULKAN", "0").env("CUDA_VISIBLE_DEVICES", "-1").env("HIP_VISIBLE_DEVICES", "-1").env("ROCR_VISIBLE_DEVICES", "-1").env("GGML_VK_VISIBLE_DEVICES", "-1");
    },
  }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn llama_models_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
  let path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("models/llama");
  std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
  let app_manifest = path.join("manifests/registry.ollama.ai/library/translategemma/4b");
  if app_manifest.exists() { return Ok(path); }
  // Reuse an existing local model when upgrading from the development build.
  // NSTrans still owns and starts its embedded runner; no external daemon is used.
  if let Some(home) = std::env::var_os("HOME") {
    let existing = std::path::PathBuf::from(home).join(".ollama/models");
    let existing_manifest = existing.join("manifests/registry.ollama.ai/library/translategemma/4b");
    if existing_manifest.exists() { return Ok(existing); }
  }
  Ok(path)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn ensure_llama_server(app: &AppHandle, shared: &Arc<Mutex<Option<Child>>>) -> Result<(), String> {
  let mut process = shared.lock().map_err(|_| "无法锁定内置 llama 运行时".to_string())?;
  if process.as_mut().and_then(|child| child.try_wait().ok()).flatten().is_some() { *process = None; }
  if process.is_none() {
    let mut command = Command::new(llama_binary(app)?);
    command.arg("serve")
      .env("OLLAMA_HOST", "127.0.0.1:11435")
      .env("OLLAMA_MODELS", llama_models_dir(app)?)
      .env("OLLAMA_NO_CLOUD", "1")
      .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    configure_llama_backend(app, &mut command);
    isolate_process(&mut command);
    let child = command.spawn().map_err(|error| format!("无法启动内置 llama 运行时：{error}"))?;
    *process = Some(child);
  }
  Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn has_translategemma(app: &AppHandle, shared: &Arc<Mutex<Option<Child>>>) -> Result<bool, String> {
  ensure_llama_server(app, shared)?;
  let client = reqwest::Client::new();
  let mut last_error = String::new();
  let mut response = None;
  for _ in 0..30 {
    match client.get(format!("{LLAMA_ORIGIN}/api/tags")).timeout(Duration::from_secs(1)).send().await {
      Ok(value) => { response = Some(value); break; },
      Err(error) => last_error = error.to_string(),
    }
    std::thread::sleep(Duration::from_millis(100));
  }
  let response = response.ok_or_else(|| format!("内置 llama 运行时未就绪：{last_error}"))?;
  let body = response.json::<LlamaTags>().await.map_err(|error| error.to_string())?;
  Ok(body.models.unwrap_or_default().iter().any(|model| model.name.starts_with("translategemma:4b")))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
// Use the llama.cpp-converted text GGUF. Ollama's registry blob is a combined
// text + vision container: Ollama can load it, but upstream llama.cpp expects
// the vision projector separately and rejects the extra tensors.
const MOBILE_TRANSLATEGEMMA_URL: &str = if cfg!(target_os = "ios") {
  "https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it.IQ4_XS.gguf"
} else {
  "https://huggingface.co/Qwe1325/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it-q4_k_m.gguf"
};

#[cfg(any(target_os = "android", target_os = "ios"))]
fn mobile_model_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
  // Tauri's Android app_data_dir resolves to Context.dataDir, while the
  // native document picker stores durable app files under Context.filesDir.
  // Keep both import and runtime lookup on that same files/models path.
  let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
  let directory = if cfg!(target_os = "android") { app_data.join("files/models/llama") } else { app_data.join("models/llama") };
  std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
  let model = directory.join("translategemma-4b.gguf");
  // Builds before 0.1.0 downloaded into dataDir/models. Preserve that large
  // download by moving it to the corrected filesDir location once.
  let legacy_model = app_data.join("models/llama/translategemma-4b.gguf");
  if cfg!(target_os = "android") && !model.exists() && legacy_model.exists() && legacy_model != model {
    std::fs::rename(&legacy_model, &model).map_err(|error| format!("迁移旧模型失败：{error}"))?;
  }
  Ok(model)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
async fn download_mobile_model(app: &AppHandle, url: &str) -> Result<(), String> {
  let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "请输入有效的模型 URL".to_string())?;
  if !matches!(parsed.scheme(), "http" | "https") { return Err("模型 URL 仅支持 HTTP 或 HTTPS".into()); }
  let finished = mobile_model_path(app)?;
  let partial = finished.with_extension("gguf.part");
  let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::limited(8)).timeout(Duration::from_secs(7200)).build().map_err(|error| error.to_string())?;
  let mut response = client.get(parsed).send().await.map_err(|error| format!("模型下载失败：{error}"))?;
  if !response.status().is_success() { return Err(format!("模型下载失败 ({})", response.status())); }
  if response.content_length().is_some_and(|length| length > 16 * 1024 * 1024 * 1024) { return Err("远程模型超过 16GB 安全上限".into()); }
  let mut file = std::fs::File::create(&partial).map_err(|error| error.to_string())?;
  let mut downloaded = 0_u64;
  while let Some(chunk) = response.chunk().await.map_err(|error| format!("模型下载中断：{error}"))? {
    downloaded += chunk.len() as u64;
    if downloaded > 16 * 1024 * 1024 * 1024 { let _ = std::fs::remove_file(&partial); return Err("远程模型超过 16GB 安全上限".into()); }
    file.write_all(&chunk).map_err(|error| error.to_string())?;
  }
  file.flush().map_err(|error| error.to_string())?;
  validate_gguf(&partial)?;
  if finished.exists() { std::fs::remove_file(&finished).map_err(|error| error.to_string())?; }
  std::fs::rename(partial, finished).map_err(|error| error.to_string())
}

#[tauri::command]
async fn translategemma_status(app: AppHandle, state: State<'_, LlamaState>) -> Result<RuntimeStatus, String> {
  #[cfg(any(target_os = "android", target_os = "ios"))]
  {
    let _ = state;
    let path = mobile_model_path(&app)?;
    return Ok(match validate_gguf(&path) {
      Ok(()) => RuntimeStatus { available: true, error: None },
      Err(_) => RuntimeStatus { available: false, error: Some("TranslateGemma 4B GGUF 模型尚未下载".into()) },
    });
  }
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
  let shared = state.0.clone();
  Ok(match has_translategemma(&app, &shared).await {
    Ok(true) => RuntimeStatus { available: true, error: None },
    Ok(false) => RuntimeStatus { available: false, error: Some("TranslateGemma 4B 模型尚未下载".into()) },
    Err(error) => RuntimeStatus { available: false, error: Some(error) },
  })
  }
}

#[tauri::command]
async fn translategemma_install(app: AppHandle, state: State<'_, LlamaState>) -> Result<RuntimeStatus, String> {
  #[cfg(any(target_os = "android", target_os = "ios"))]
  {
    download_mobile_model(&app, MOBILE_TRANSLATEGEMMA_URL).await?;
    state.0.lock().map_err(|_| "无法锁定 llama.cpp 运行时".to_string())?.unload();
    return Ok(RuntimeStatus { available: true, error: None });
  }
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
  let shared = state.0.clone();
  ensure_llama_server(&app, &shared)?;
  let payload = serde_json::json!({ "name": "translategemma:4b", "stream": false });
  let response = reqwest::Client::new().post(format!("{LLAMA_ORIGIN}/api/pull")).json(&payload)
    .timeout(Duration::from_secs(7200)).send().await.map_err(|error| format!("模型下载失败：{error}"))?;
  if !response.status().is_success() { return Err(format!("模型下载失败 ({})", response.status())); }
  Ok(RuntimeStatus { available: true, error: None })
  }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
const TRANSLATEGEMMA_TEMPLATE: &str = r#"TEMPLATE """{{- range $i, $_ := .Messages }}
{{- $last := eq (len (slice $.Messages $i)) 1 }}
{{- if or (eq .Role "user") (eq .Role "system") }}<start_of_turn>user
{{ .Content }}<end_of_turn>
{{ if $last }}<start_of_turn>model
{{ end }}
{{- else if eq .Role "assistant" }}<start_of_turn>model
{{ .Content }}{{ if not $last }}<end_of_turn>
{{ end }}
{{- end }}
{{- end }}"""
PARAMETER temperature 0
PARAMETER top_p 0.95
PARAMETER top_k 64
PARAMETER stop <end_of_turn>
"#;

fn validate_gguf(path: &std::path::Path) -> Result<(), String> {
  let metadata = std::fs::metadata(path).map_err(|error| format!("无法读取模型文件：{error}"))?;
  if !metadata.is_file() { return Err("选择的路径不是模型文件".into()); }
  if metadata.len() < 1024 * 1024 { return Err("模型文件过小，不是有效的 GGUF".into()); }
  if metadata.len() > 16 * 1024 * 1024 * 1024 { return Err("模型文件超过 16GB 安全上限".into()); }
  let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
  let mut magic = [0_u8; 4];
  std::io::Read::read_exact(&mut file, &mut magic).map_err(|error| error.to_string())?;
  if &magic != b"GGUF" { return Err("文件不是 GGUF 模型".into()); }
  Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn import_gguf(app: &AppHandle, shared: &Arc<Mutex<Option<Child>>>, path: &std::path::Path) -> Result<RuntimeStatus, String> {
  validate_gguf(path)?;
  ensure_llama_server(app, shared)?;
  let canonical = path.canonicalize().map_err(|error| error.to_string())?;
  if canonical.to_string_lossy().contains(['\n', '\r']) { return Err("模型路径包含非法换行符".into()); }
  let import_dir = app.path().app_cache_dir().map_err(|error| error.to_string())?.join("model-import");
  std::fs::create_dir_all(&import_dir).map_err(|error| error.to_string())?;
  let modelfile = import_dir.join("Modelfile");
  std::fs::write(&modelfile, format!("FROM {}\n{}", canonical.display(), TRANSLATEGEMMA_TEMPLATE)).map_err(|error| error.to_string())?;
  let mut command = Command::new(llama_binary(app)?);
  command.args(["create", "translategemma:4b", "-f"]).arg(&modelfile)
    .env("OLLAMA_HOST", "127.0.0.1:11435")
    .env("OLLAMA_MODELS", llama_models_dir(app)?)
    .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
  let output = command.output().map_err(|error| format!("无法导入模型：{error}"))?;
  if !output.status.success() {
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if detail.is_empty() { "模型导入失败".into() } else { detail });
  }
  Ok(RuntimeStatus { available: true, error: None })
}

#[tauri::command]
async fn translategemma_import_file(app: AppHandle, state: State<'_, LlamaState>, path: String) -> Result<RuntimeStatus, String> {
  #[cfg(any(target_os = "android", target_os = "ios"))]
  {
    let destination = mobile_model_path(&app)?;
    let source = std::path::PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
      validate_gguf(&source)?;
      let partial = destination.with_extension("gguf.part");
      std::fs::copy(&source, &partial).map_err(|error| format!("无法导入模型：{error}"))?;
      if destination.exists() { std::fs::remove_file(&destination).map_err(|error| error.to_string())?; }
      std::fs::rename(partial, destination).map_err(|error| error.to_string())
    }).await.map_err(|error| format!("模型导入任务失败：{error}"))??;
    state.0.lock().map_err(|_| "无法锁定 llama.cpp 运行时".to_string())?.unload();
    return Ok(RuntimeStatus { available: true, error: None });
  }
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
  let shared = state.0.clone();
  tauri::async_runtime::spawn_blocking(move || import_gguf(&app, &shared, std::path::Path::new(&path)))
    .await.map_err(|error| format!("模型导入任务失败：{error}"))?
  }
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn translategemma_pick_file(app: AppHandle, state: State<'_, LlamaState>) -> Result<ModelPickerResult, String> {
  let Some(file) = rfd::AsyncFileDialog::new()
    .add_filter("GGUF 模型", &["gguf"])
    .set_title("选择 TranslateGemma GGUF 模型")
    .pick_file().await else {
      return Ok(ModelPickerResult { available: false, cancelled: true, error: None });
    };
  let path = file.path().to_path_buf();
  let shared = state.0.clone();
  let status = tauri::async_runtime::spawn_blocking(move || import_gguf(&app, &shared, &path))
    .await.map_err(|error| format!("模型导入任务失败：{error}"))??;
  Ok(ModelPickerResult { available: status.available, cancelled: false, error: status.error })
}

#[tauri::command]
#[cfg(target_os = "android")]
async fn translategemma_pick_file(app: AppHandle, state: State<'_, LlamaState>) -> Result<ModelPickerResult, String> {
  let runtime = app.state::<android_runtime::AndroidRuntime<tauri::Wry>>().inner().clone();
  let result = runtime.pick_model()?;
  if result.available {
    validate_gguf(&mobile_model_path(&app)?)?;
    state.0.lock().map_err(|_| "无法锁定 llama.cpp 运行时".to_string())?.unload();
  }
  Ok(ModelPickerResult { available: result.available, cancelled: result.cancelled, error: result.error })
}

#[tauri::command]
#[cfg(target_os = "ios")]
async fn translategemma_pick_file(app: AppHandle, state: State<'_, LlamaState>) -> Result<ModelPickerResult, String> {
  let model = mobile_model_path(&app)?;
  let staged = model.with_extension("gguf.importing");
  let picked = tauri::async_runtime::spawn_blocking(move || ios_bridge::pick_model(&staged))
    .await.map_err(|error| format!("模型选择任务失败：{error}"))??;
  let result: ModelPickerResult = serde_json::from_value(picked).map_err(|error| format!("无法解析模型选择结果：{error}"))?;
  if result.cancelled || !result.available { return Ok(result); }
  let staged = model.with_extension("gguf.importing");
  if let Err(error) = validate_gguf(&staged) {
    let _ = std::fs::remove_file(&staged);
    return Err(error);
  }
  if model.exists() { std::fs::remove_file(&model).map_err(|error| format!("无法替换旧模型：{error}"))?; }
  std::fs::rename(&staged, &model).map_err(|error| format!("无法启用模型：{error}"))?;
  state.0.lock().map_err(|_| "无法锁定 llama.cpp 运行时".to_string())?.unload();
  Ok(ModelPickerResult { available: true, cancelled: false, error: None })
}

#[tauri::command]
async fn translategemma_install_url(app: AppHandle, state: State<'_, LlamaState>, url: String) -> Result<RuntimeStatus, String> {
  #[cfg(any(target_os = "android", target_os = "ios"))]
  {
    download_mobile_model(&app, &url).await?;
    state.0.lock().map_err(|_| "无法锁定 llama.cpp 运行时".to_string())?.unload();
    return Ok(RuntimeStatus { available: true, error: None });
  }
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
  let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "请输入有效的模型 URL".to_string())?;
  if !matches!(parsed.scheme(), "http" | "https") { return Err("模型 URL 仅支持 HTTP 或 HTTPS".into()); }
  let download_dir = app.path().app_cache_dir().map_err(|error| error.to_string())?.join("model-download");
  std::fs::create_dir_all(&download_dir).map_err(|error| error.to_string())?;
  let partial = download_dir.join("custom-model.gguf.part");
  let finished = download_dir.join("custom-model.gguf");
  let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::limited(8)).timeout(Duration::from_secs(7200)).build().map_err(|error| error.to_string())?;
  let mut response = client.get(parsed).send().await.map_err(|error| format!("模型下载失败：{error}"))?;
  if !response.status().is_success() { return Err(format!("模型下载失败 ({})", response.status())); }
  if response.content_length().is_some_and(|length| length > 16 * 1024 * 1024 * 1024) { return Err("远程模型超过 16GB 安全上限".into()); }
  let mut file = std::fs::File::create(&partial).map_err(|error| error.to_string())?;
  let mut downloaded = 0_u64;
  while let Some(chunk) = response.chunk().await.map_err(|error| format!("模型下载中断：{error}"))? {
    downloaded += chunk.len() as u64;
    if downloaded > 16 * 1024 * 1024 * 1024 { let _ = std::fs::remove_file(&partial); return Err("远程模型超过 16GB 安全上限".into()); }
    file.write_all(&chunk).map_err(|error| error.to_string())?;
  }
  file.flush().map_err(|error| error.to_string())?;
  if finished.exists() { std::fs::remove_file(&finished).map_err(|error| error.to_string())?; }
  std::fs::rename(&partial, &finished).map_err(|error| error.to_string())?;
  let shared = state.0.clone();
  tauri::async_runtime::spawn_blocking(move || import_gguf(&app, &shared, &finished))
    .await.map_err(|error| format!("模型导入任务失败：{error}"))?
  }
}

#[tauri::command]
async fn translategemma_generate(app: AppHandle, state: State<'_, LlamaState>, prompt: String) -> Result<GeneratedTranslation, String> {
  #[cfg(any(target_os = "android", target_os = "ios"))]
  {
    let path = mobile_model_path(&app)?;
    validate_gguf(&path)?;
    let shared = state.0.clone();
    let translation = tauri::async_runtime::spawn_blocking(move || shared.lock().map_err(|_| "无法锁定 llama.cpp 运行时".to_string())?.generate(&path, &prompt))
      .await.map_err(|error| format!("TranslateGemma 推理任务失败：{error}"))??;
    return Ok(GeneratedTranslation { translation });
  }
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
  let shared = state.0.clone();
  if !has_translategemma(&app, &shared).await.unwrap_or(false) { return Err("TranslateGemma 4B 尚未安装，请先在 NSTrans 内下载模型".into()); }
  let payload = serde_json::json!({
    "model": "translategemma:4b", "stream": false,
    "messages": [{ "role": "user", "content": prompt }],
    "options": { "temperature": 0 }, "keep_alive": "5m"
  });
  let response = reqwest::Client::new().post(format!("{LLAMA_ORIGIN}/api/chat")).json(&payload).timeout(Duration::from_secs(120)).send().await.map_err(|error| format!("TranslateGemma 请求失败：{error}"))?;
  let status = response.status();
  let body = response.json::<LlamaChatResponse>().await.map_err(|error| format!("无法解析 TranslateGemma 响应：{error}"))?;
  let content = body.message.map(|message| message.content.trim().trim_matches(['\'', '"']).to_string()).filter(|value| !value.is_empty());
  if !status.is_success() || content.is_none() { return Err(body.error.unwrap_or_else(|| format!("TranslateGemma 没有返回结果 ({status})"))); }
  Ok(GeneratedTranslation { translation: content.unwrap() })
  }
}

#[tauri::command]
async fn translategemma_unload(state: State<'_, LlamaState>) -> Result<(), String> {
  #[cfg(any(target_os = "android", target_os = "ios"))]
  {
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
      shared.lock().map_err(|_| "无法锁定 llama.cpp 运行时".to_string())?.unload();
      Ok::<(), String>(())
    }).await.map_err(|error| format!("释放 TranslateGemma 任务失败：{error}"))??;
  }
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
    // Desktop Ollama has its own keep-alive policy; this command intentionally
    // remains a no-op so the frontend lifecycle can stay platform-neutral.
    let _ = state;
  }
  Ok(())
}

#[tauri::command]
fn translategemma_backend_status(app: AppHandle) -> Result<LlamaBackendStatus, String> {
  #[cfg(target_os = "windows")]
  return Ok(LlamaBackendStatus { backend: selected_llama_backend(&app) });

  #[cfg(not(target_os = "windows"))]
  {
    let _ = app;
    Ok(LlamaBackendStatus { backend: "cpu".into() })
  }
}

#[tauri::command]
fn translategemma_set_backend(app: AppHandle, state: State<'_, LlamaState>, backend: String) -> Result<LlamaBackendStatus, String> {
  #[cfg(target_os = "windows")]
  {
    let backend = backend.trim().to_lowercase();
    if !matches!(backend.as_str(), "cuda" | "vulkan" | "cpu") { return Err("不支持的 llama.cpp 推理后端".into()); }
    std::fs::write(llama_backend_path(&app)?, &backend).map_err(|error| format!("无法保存推理后端设置：{error}"))?;
    let mut process = state.0.lock().map_err(|_| "无法锁定内置 llama 运行时".to_string())?;
    if let Some(child) = process.as_mut() { terminate_process(child); let _ = child.wait(); }
    *process = None;
    return Ok(LlamaBackendStatus { backend });
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = (app, state, backend);
    Err("推理后端手动选择目前仅支持 Windows".into())
  }
}

#[tauri::command]
async fn entity_web_search(engine: String, query: String, api_key: String) -> Result<Vec<EntitySearchHit>, String> {
  if query.trim().is_empty() || api_key.trim().is_empty() { return Err("搜索查询或 API Key 为空".into()); }
  let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(8)).build().map_err(|error| error.to_string())?;
  if engine == "brave" {
    let response = client.get("https://api.search.brave.com/res/v1/web/search")
      .query(&[("q", query.as_str()), ("count", "8"), ("extra_snippets", "true")])
      .header("accept", "application/json").header("x-subscription-token", api_key).send().await.map_err(|error| format!("Brave Search 请求失败：{error}"))?;
    let status = response.status();
    let body = response.json::<serde_json::Value>().await.map_err(|error| error.to_string())?;
    if !status.is_success() { return Err(body.get("message").and_then(|value| value.as_str()).unwrap_or("Brave Search 不可用").into()); }
    return Ok(body.pointer("/web/results").and_then(|value| value.as_array()).into_iter().flatten().filter_map(|item| {
      let url = item.get("url")?.as_str()?.to_string();
      if !url.starts_with("https://") { return None; }
      let mut snippets = vec![item.get("description").and_then(|value| value.as_str()).unwrap_or("").to_string()];
      snippets.extend(item.get("extra_snippets").and_then(|value| value.as_array()).into_iter().flatten().filter_map(|value| value.as_str().map(String::from)));
      Some(EntitySearchHit { title: item.get("title").and_then(|value| value.as_str()).unwrap_or("").to_string(), url, snippet: snippets.into_iter().filter(|value| !value.is_empty()).collect::<Vec<_>>().join(" | ") })
    }).take(8).collect());
  }
  if engine == "qianfan" {
    let payload = serde_json::json!({ "messages": [{ "role": "user", "content": query.chars().take(60).collect::<String>() }], "search_source": "baidu_search_v2", "edition": "lite", "resource_type_filter": [{ "type": "web", "top_k": 8 }] });
    let response = client.post("https://qianfan.baidubce.com/v2/ai_search/web_search").bearer_auth(api_key).json(&payload).send().await.map_err(|error| format!("百度千帆搜索请求失败：{error}"))?;
    let status = response.status();
    let body = response.json::<serde_json::Value>().await.map_err(|error| error.to_string())?;
    if !status.is_success() { return Err(body.get("message").and_then(|value| value.as_str()).unwrap_or("百度千帆搜索不可用").into()); }
    return Ok(body.get("references").and_then(|value| value.as_array()).into_iter().flatten().filter_map(|item| {
      let url = item.get("url")?.as_str()?.to_string();
      if !url.starts_with("https://") { return None; }
      Some(EntitySearchHit { title: item.get("title").and_then(|value| value.as_str()).unwrap_or("").to_string(), url, snippet: item.get("content").or_else(|| item.get("snippet")).and_then(|value| value.as_str()).unwrap_or("").to_string() })
    }).take(8).collect());
  }
  Err("不支持的搜索引擎".into())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslationOutput {
  available: bool,
  translations: Option<Vec<String>>,
  error: Option<String>,
}

fn translation_binary(app: &AppHandle) -> Result<std::path::PathBuf, String> {
  if cfg!(debug_assertions) {
    Ok(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../native/macos/bin/nstrans-translate"))
  } else {
    app.path().resolve("bin/nstrans-translate", BaseDirectory::Resource).map_err(|error| error.to_string())
  }
}

fn vision_binary(app: &AppHandle) -> Result<std::path::PathBuf, String> {
  if cfg!(debug_assertions) {
    Ok(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../native/macos/bin/nstrans-vision-ocr"))
  } else {
    app.path().resolve("bin/nstrans-vision-ocr", BaseDirectory::Resource).map_err(|error| error.to_string())
  }
}

fn meiki_binary(app: &AppHandle) -> Result<std::path::PathBuf, String> {
  if cfg!(debug_assertions) {
    let relative = if cfg!(target_os = "windows") { "../native/runtime/windows/nstrans-meiki-ocr.exe" } else { "../native/runtime/macos/nstrans-meiki-ocr" };
    Ok(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative))
  } else {
    let relative = if cfg!(target_os = "windows") { "runtime/nstrans-meiki-ocr.exe" } else { "runtime/nstrans-meiki-ocr" };
    app.path().resolve(relative, BaseDirectory::Resource).map_err(|error| error.to_string())
  }
}

struct MeikiProcess { child: Child, input: ChildStdin, output: BufReader<ChildStdout> }
#[derive(Clone)]
struct MeikiState(Arc<Mutex<Option<MeikiProcess>>>);

impl Drop for MeikiState {
  fn drop(&mut self) {
    if let Ok(mut guard) = self.0.lock() {
      if let Some(process) = guard.as_mut() { terminate_process(&mut process.child); }
    }
  }
}

fn ensure_meiki_process(app: &AppHandle, guard: &mut Option<MeikiProcess>) -> Result<(), String> {
  if guard.as_mut().and_then(|process| process.child.try_wait().ok()).flatten().is_some() { *guard = None; }
  if guard.is_none() {
    let mut command = Command::new(meiki_binary(app)?);
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    isolate_process(&mut command);
    let mut child = command.spawn().map_err(|error| format!("无法启动 MeikiOCR：{error}"))?;
    let input = child.stdin.take().ok_or("无法连接 MeikiOCR 输入")?;
    let output = BufReader::new(child.stdout.take().ok_or("无法连接 MeikiOCR 输出")?);
    *guard = Some(MeikiProcess { child, input, output });
  }
  Ok(())
}

fn run_meiki_ocr(app: &AppHandle, shared: &Arc<Mutex<Option<MeikiProcess>>>, image: Vec<u8>, _minimum_confidence: f64) -> Result<serde_json::Value, String> {
  use base64::Engine;
  let mut guard = shared.lock().map_err(|_| "无法锁定 MeikiOCR 进程".to_string())?;
  ensure_meiki_process(app, &mut guard)?;
  let process = guard.as_mut().ok_or("MeikiOCR 未启动")?;
  let request = serde_json::json!({
    "image": base64::engine::general_purpose::STANDARD.encode(image),
    "det_threshold": 0.45,
    "rec_threshold": 0.15,
  });
  writeln!(process.input, "{request}").map_err(|error| format!("无法写入 MeikiOCR：{error}"))?;
  process.input.flush().map_err(|error| error.to_string())?;
  let mut line = String::new();
  loop {
    line.clear();
    if process.output.read_line(&mut line).map_err(|error| format!("无法读取 MeikiOCR：{error}"))? == 0 {
      *guard = None;
      return Err("MeikiOCR 进程意外退出".into());
    }
    if let Some(result) = line.strip_prefix("YOMI_RESULT:") {
      return serde_json::from_str(result).map_err(|error| format!("无法解析 MeikiOCR 结果：{error}"));
    }
  }
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn meiki_ocr(app: AppHandle, state: State<'_, MeikiState>, image_base64: String, minimum_confidence: f64) -> Result<serde_json::Value, String> {
  use base64::Engine as _;
  let image = base64::engine::general_purpose::STANDARD.decode(image_base64).map_err(|error| format!("OCR 图像解码失败：{error}"))?;
  let shared = state.0.clone();
  tauri::async_runtime::spawn_blocking(move || run_meiki_ocr(&app, &shared, image, minimum_confidence))
    .await.map_err(|error| format!("MeikiOCR 任务失败：{error}"))?
}

#[tauri::command]
#[cfg(target_os = "ios")]
async fn meiki_ocr(_image_base64: String, _minimum_confidence: f64) -> Result<serde_json::Value, String> {
  Err("iPad 版本仅使用 Apple Vision OCR".into())
}

#[tauri::command]
#[cfg(target_os = "android")]
async fn meiki_ocr(state: State<'_, android_runtime::AndroidRuntime<tauri::Wry>>, image_base64: String, minimum_confidence: f64) -> Result<serde_json::Value, String> {
  let runtime = state.inner().clone();
  tauri::async_runtime::spawn_blocking(move || runtime.recognize(image_base64, minimum_confidence))
    .await.map_err(|error| format!("Android MeikiOCR 任务失败：{error}"))?
}

#[tauri::command]
#[cfg(target_os = "android")]
fn meiki_ocr_unload(state: State<'_, android_runtime::AndroidRuntime<tauri::Wry>>) -> Result<(), String> {
  state.unload_ocr()
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn meiki_ocr_unload(state: State<'_, MeikiState>) -> Result<(), String> {
  let mut guard = state.0.lock().map_err(|_| "无法锁定 MeikiOCR 进程".to_string())?;
  if let Some(process) = guard.as_mut() { terminate_process(&mut process.child); }
  *guard = None;
  Ok(())
}

#[tauri::command]
#[cfg(target_os = "ios")]
fn meiki_ocr_unload() -> Result<(), String> { Ok(()) }

#[tauri::command]
#[cfg(target_os = "android")]
fn usb_video_devices(state: State<'_, android_runtime::AndroidRuntime<tauri::Wry>>) -> Result<serde_json::Value, String> {
  state.usb_devices()
}

#[tauri::command]
#[cfg(target_os = "ios")]
fn usb_video_devices() -> Result<serde_json::Value, String> { ios_bridge::usb_devices() }

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn usb_video_devices() -> Result<serde_json::Value, String> { Ok(serde_json::json!({ "devices": [] })) }

#[tauri::command]
#[cfg(target_os = "android")]
async fn usb_video_open(state: State<'_, android_runtime::AndroidRuntime<tauri::Wry>>, device_id: String) -> Result<serde_json::Value, String> {
  let runtime = state.inner().clone();
  tauri::async_runtime::spawn_blocking(move || runtime.open_usb_camera(device_id))
    .await.map_err(|error| format!("USB 采集卡打开任务失败：{error}"))?
}

#[tauri::command]
#[cfg(target_os = "ios")]
async fn usb_video_open(device_id: String) -> Result<serde_json::Value, String> {
  tauri::async_runtime::spawn_blocking(move || ios_bridge::open_usb_camera(&device_id))
    .await.map_err(|error| format!("USB 采集卡打开任务失败：{error}"))?
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn usb_video_open(_device_id: String) -> Result<serde_json::Value, String> { Err("原生 USB UVC 仅用于 Android".into()) }

#[tauri::command]
#[cfg(target_os = "android")]
fn usb_video_close(state: State<'_, android_runtime::AndroidRuntime<tauri::Wry>>) -> Result<(), String> { state.close_usb_camera() }

#[tauri::command]
#[cfg(target_os = "ios")]
fn usb_video_close() -> Result<(), String> { ios_bridge::close_usb_camera() }

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn usb_video_close() -> Result<(), String> { Ok(()) }

#[tauri::command]
#[cfg(target_os = "android")]
async fn usb_video_frame(state: State<'_, android_runtime::AndroidRuntime<tauri::Wry>>) -> Result<serde_json::Value, String> {
  let runtime = state.inner().clone();
  tauri::async_runtime::spawn_blocking(move || runtime.usb_frame())
    .await.map_err(|error| format!("USB 采集卡取帧任务失败：{error}"))?
}

#[tauri::command]
#[cfg(target_os = "ios")]
async fn usb_video_frame() -> Result<serde_json::Value, String> {
  tauri::async_runtime::spawn_blocking(ios_bridge::usb_frame)
    .await.map_err(|error| format!("USB 采集卡取帧任务失败：{error}"))?
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn usb_video_frame() -> Result<serde_json::Value, String> { Err("原生 USB UVC 仅用于 Android".into()) }

fn run_translation_helper(app: &AppHandle, status_only: bool, texts: Vec<String>) -> Result<TranslationOutput, String> {
  #[cfg(not(target_os = "macos"))]
  return Ok(TranslationOutput { available: false, translations: None, error: Some("系统翻译目前仅支持 macOS。".into()) });

  #[cfg(target_os = "macos")]
  {
    let mut command = Command::new(translation_binary(app)?);
    if status_only { command.arg("--status"); }
    let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|error| error.to_string())?;
    if !status_only {
      let input = serde_json::json!({ "texts": texts }).to_string();
      child.stdin.as_mut().ok_or("无法连接系统翻译输入")?.write_all(input.as_bytes()).map_err(|error| error.to_string())?;
    }
    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    serde_json::from_slice(&output.stdout).map_err(|error| format!("无法解析系统翻译结果：{error}"))
  }
}

#[tauri::command]
fn mac_translation_status(app: AppHandle) -> Result<TranslationOutput, String> {
  run_translation_helper(&app, true, Vec::new())
}

#[tauri::command]
fn mac_translate(app: AppHandle, texts: Vec<String>) -> Result<TranslationOutput, String> {
  run_translation_helper(&app, false, texts)
}

#[tauri::command]
fn mac_vision_ocr(app: AppHandle, image: Vec<u8>) -> Result<serde_json::Value, String> {
  #[cfg(target_os = "ios")]
  {
    let _ = app;
    return ios_bridge::recognize(&image);
  }

  #[cfg(not(any(target_os = "macos", target_os = "ios")))]
  return Err("Vision OCR 目前仅支持 macOS。".into());

  #[cfg(target_os = "macos")]
  {
    let mut child = Command::new(vision_binary(&app)?).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|error| error.to_string())?;
    child.stdin.as_mut().ok_or("无法连接 Vision OCR 输入")?.write_all(&image).map_err(|error| error.to_string())?;
    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    serde_json::from_slice(&output.stdout).map_err(|error| format!("无法解析 Vision OCR 结果：{error}"))
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let application = tauri::Builder::default();
  #[cfg(target_os = "android")]
  let application = application.plugin(android_runtime::init());
  #[cfg(target_os = "android")]
  let application = application.manage(LlamaState(Arc::new(Mutex::new(
    android_llm::MobileLlm::new().expect("无法初始化 Android llama.cpp 运行时"),
  ))));
  #[cfg(target_os = "ios")]
  let application = application.manage(LlamaState(Arc::new(Mutex::new(
    android_llm::MobileLlm::new().expect("无法初始化 iOS llama.cpp 运行时"),
  ))));
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  let application = application.manage(LlamaState(Arc::new(Mutex::new(None))));
  let application = application
    .manage(MeikiState(Arc::new(Mutex::new(None))))
    .invoke_handler(tauri::generate_handler![client_platform, mac_translation_status, mac_translate, mac_vision_ocr, meiki_ocr, meiki_ocr_unload, usb_video_devices, usb_video_open, usb_video_close, usb_video_frame, translategemma_status, translategemma_install, translategemma_install_url, translategemma_import_file, translategemma_pick_file, translategemma_generate, translategemma_unload, translategemma_backend_status, translategemma_set_backend, entity_web_search])
    .setup(|app| {
      #[cfg(not(any(target_os = "android", target_os = "ios")))]
      {
      let meiki = app.state::<MeikiState>().0.clone();
      let handle = app.handle().clone();
      tauri::async_runtime::spawn_blocking(move || {
        if let Ok(mut guard) = meiki.lock() { let _ = ensure_meiki_process(&handle, &mut guard); }
      });
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");
  application.run(|app, event| {
    if matches!(event, tauri::RunEvent::Exit) {
      #[cfg(not(any(target_os = "android", target_os = "ios")))]
      {
      if let Ok(mut guard) = app.state::<LlamaState>().0.lock() {
        if let Some(child) = guard.as_mut() { terminate_process(child); }
      }
      }
      #[cfg(not(any(target_os = "android", target_os = "ios")))]
      { if let Ok(mut guard) = app.state::<MeikiState>().0.lock() { if let Some(process) = guard.as_mut() { terminate_process(&mut process.child); } } }
    }
  });
}
