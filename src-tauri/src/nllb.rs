use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};

const PACKAGE_NAME: &str = "nstrans-nllb-200-distilled-600M-q8-v1";
const PACKAGE_URL: &str = "https://nstrans.221129.xyz/download/model/nllb";
const PACKAGE_SHA256: &str = "bd9a15c30464b41406fd69c5ea1df67dd02bac9631178ba12527533832e4b1f6";
const PACKAGE_BYTES: u64 = 916_828_255;
const REQUIRED_FILES: &[&str] = &[
    "nstrans-model-manifest.json",
    "config.json",
    "generation_config.json",
    "sentencepiece.bpe.model",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "onnx/encoder_model_quantized.onnx",
    "onnx/decoder_model_merged_quantized.onnx",
];

#[derive(Clone)]
pub struct NllbState {
    root: Arc<PathBuf>,
    origin: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NllbProgress {
    phase: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NllbStatus {
    available: bool,
    model_url: Option<String>,
    error: Option<String>,
}

impl NllbState {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("models/nllb");
        std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|error| format!("无法启动 NLLB 本机模型服务：{error}"))?;
        let address = listener.local_addr().map_err(|error| error.to_string())?;
        let shared_root = Arc::new(root);
        let server_root = shared_root.clone();
        thread::Builder::new()
            .name("nstrans-nllb-files".into())
            .spawn(move || {
                for connection in listener.incoming() {
                    match connection {
                        Ok(stream) => serve_file(stream, &server_root),
                        Err(error) => log::warn!("NLLB 本机模型服务连接失败：{error}"),
                    }
                }
            })
            .map_err(|error| format!("无法启动 NLLB 本机模型线程：{error}"))?;
        Ok(Self {
            root: shared_root,
            origin: format!("http://{address}/nllb"),
        })
    }

    fn package_dir(&self) -> PathBuf {
        self.root.join(PACKAGE_NAME)
    }

    fn installed(&self) -> bool {
        let directory = self.package_dir();
        REQUIRED_FILES
            .iter()
            .all(|relative| directory.join(relative).is_file())
    }

    fn status(&self) -> NllbStatus {
        if self.installed() {
            NllbStatus {
                available: true,
                model_url: Some(self.origin.clone()),
                error: None,
            }
        } else {
            NllbStatus {
                available: false,
                model_url: None,
                error: Some("NLLB-600M 本机模型尚未安装".into()),
            }
        }
    }
}

fn serve_file(mut stream: TcpStream, root: &Path) {
    let cloned = match stream.try_clone() {
        Ok(value) => value,
        Err(_) => return,
    };
    let mut reader = BufReader::new(cloned);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let mut header = String::new();
    loop {
        header.clear();
        if reader.read_line(&mut header).is_err() || header == "\r\n" || header.is_empty() {
            break;
        }
    }
    let mut fields = request_line.split_whitespace();
    let method = fields.next().unwrap_or("");
    let request_path = fields.next().unwrap_or("").split('?').next().unwrap_or("");
    if !matches!(method, "GET" | "HEAD") || !request_path.starts_with("/nllb/") {
        let _ = write_response(&mut stream, 404, "text/plain", 0, None);
        return;
    }
    let relative = request_path.trim_start_matches("/nllb/");
    let relative_path = Path::new(relative);
    if relative_path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        let _ = write_response(&mut stream, 400, "text/plain", 0, None);
        return;
    }
    let path = root.join(PACKAGE_NAME).join(relative_path);
    let mut file = match File::open(&path) {
        Ok(value) => value,
        Err(_) => {
            let _ = write_response(&mut stream, 404, "text/plain", 0, None);
            return;
        }
    };
    let length = match file.metadata() {
        Ok(value) => value.len(),
        Err(_) => 0,
    };
    let content_type = match path.extension().and_then(|value| value.to_str()) {
        Some("json") => "application/json",
        Some("onnx") => "application/octet-stream",
        Some("model") => "application/octet-stream",
        Some("txt") | Some("md") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };
    if write_response(
        &mut stream,
        200,
        content_type,
        length,
        Some("public, max-age=31536000, immutable"),
    )
    .is_ok()
        && method == "GET"
    {
        let _ = std::io::copy(&mut file, &mut stream);
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    length: u64,
    cache_control: Option<&str>,
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        _ => "Not Found",
    };
    write!(stream, "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {length}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: {}\r\nConnection: close\r\n\r\n", cache_control.unwrap_or("no-store"))
}

fn emit_progress(app: &AppHandle, phase: &str, downloaded: u64, total: Option<u64>) {
    let percent = total
        .filter(|value| *value > 0)
        .map(|value| downloaded as f64 / value as f64 * 100.0);
    let _ = app.emit(
        "nllb-model-progress",
        NllbProgress {
            phase: phase.into(),
            downloaded_bytes: downloaded,
            total_bytes: total,
            percent,
        },
    );
}

fn sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

async fn download_archive(app: &AppHandle, destination: &Path) -> Result<(), String> {
    let partial = destination.with_extension("zip.part");
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(8))
        .timeout(Duration::from_secs(7200))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get(PACKAGE_URL)
        .send()
        .await
        .map_err(|error| format!("NLLB 模型包下载失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("NLLB 模型包下载失败 ({})", response.status()));
    }
    let total = response.content_length().or(Some(PACKAGE_BYTES));
    let mut file = File::create(&partial).map_err(|error| error.to_string())?;
    let mut downloaded = 0_u64;
    let mut last_progress = Instant::now() - Duration::from_secs(1);
    emit_progress(app, "downloading", 0, total);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("NLLB 模型包下载中断：{error}"))?
    {
        downloaded += chunk.len() as u64;
        if downloaded > PACKAGE_BYTES + 1024 {
            let _ = std::fs::remove_file(&partial);
            return Err("NLLB 模型包超过预期大小".into());
        }
        file.write_all(&chunk).map_err(|error| error.to_string())?;
        if last_progress.elapsed() >= Duration::from_millis(200) || downloaded == PACKAGE_BYTES {
            emit_progress(app, "downloading", downloaded, total);
            last_progress = Instant::now();
        }
    }
    file.flush().map_err(|error| error.to_string())?;
    if downloaded != PACKAGE_BYTES {
        let _ = std::fs::remove_file(&partial);
        return Err(format!(
            "NLLB 模型包大小不完整：{downloaded}/{PACKAGE_BYTES}"
        ));
    }
    emit_progress(app, "validating", downloaded, total);
    if sha256(&partial)? != PACKAGE_SHA256 {
        let _ = std::fs::remove_file(&partial);
        return Err("NLLB 模型包 SHA-256 校验失败".into());
    }
    if destination.exists() {
        std::fs::remove_file(destination).map_err(|error| error.to_string())?;
    }
    std::fs::rename(partial, destination).map_err(|error| error.to_string())
}

fn extract_archive(archive_path: &Path, state: &NllbState) -> Result<(), String> {
    let staging = state.root.join(format!("{PACKAGE_NAME}.installing"));
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
    }
    std::fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let file = File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| format!("无法读取 NLLB 模型包：{error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "NLLB 模型包包含不安全路径".to_string())?;
        let output = staging.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&output).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut target = File::create(&output).map_err(|error| error.to_string())?;
            std::io::copy(&mut entry, &mut target)
                .map_err(|error| format!("解压 NLLB 模型失败：{error}"))?;
        }
    }
    let extracted = staging.join(PACKAGE_NAME);
    if !REQUIRED_FILES
        .iter()
        .all(|relative| extracted.join(relative).is_file())
    {
        let _ = std::fs::remove_dir_all(&staging);
        return Err("NLLB 模型包缺少必要文件".into());
    }
    let destination = state.package_dir();
    if destination.exists() {
        std::fs::remove_dir_all(&destination).map_err(|error| error.to_string())?;
    }
    std::fs::rename(&extracted, &destination).map_err(|error| error.to_string())?;
    let _ = std::fs::remove_dir_all(&staging);
    Ok(())
}

#[tauri::command]
pub fn nllb_status(state: State<'_, NllbState>) -> NllbStatus {
    state.status()
}

#[tauri::command]
pub async fn nllb_install(
    app: AppHandle,
    state: State<'_, NllbState>,
) -> Result<NllbStatus, String> {
    if state.installed() {
        return Ok(state.status());
    }
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("model-download");
    let archive_path = cache.join(format!("{PACKAGE_NAME}.zip"));
    download_archive(&app, &archive_path).await?;
    emit_progress(&app, "extracting", PACKAGE_BYTES, Some(PACKAGE_BYTES));
    let owned_state = state.inner().clone();
    let owned_archive = archive_path.clone();
    tauri::async_runtime::spawn_blocking(move || extract_archive(&owned_archive, &owned_state))
        .await
        .map_err(|error| format!("NLLB 解压任务失败：{error}"))??;
    let _ = std::fs::remove_file(&archive_path);
    emit_progress(&app, "completed", PACKAGE_BYTES, Some(PACKAGE_BYTES));
    Ok(state.status())
}
