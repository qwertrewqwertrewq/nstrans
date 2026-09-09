use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
  collections::HashMap,
  io::{Read, Write},
  net::{SocketAddr, TcpStream, ToSocketAddrs, UdpSocket},
  sync::{Arc, Mutex},
  thread,
  time::{Duration, SystemTime, UNIX_EPOCH},
};

const DISCOVERY_PORT: u16 = 38_472;
const RECEIVER_PORT: u16 = 38_471;
const DEVICE_TTL_MS: u64 = 12_000;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Clone)]
pub struct TvCastState {
  devices: Arc<Mutex<HashMap<String, TvDevice>>>,
  connection: Arc<Mutex<Option<TvConnection>>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TvDevice {
  id: String,
  name: String,
  address: String,
  port: u16,
  last_seen_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TvConnectionStatus {
  connected: bool,
  name: Option<String>,
  address: Option<String>,
}

#[derive(Clone, Debug)]
struct TvConnection {
  name: String,
  address: String,
  socket: SocketAddr,
  token: String,
}

#[derive(Debug, Deserialize)]
struct Announcement {
  protocol: String,
  id: String,
  name: String,
  port: Option<u16>,
}

impl TvCastState {
  pub fn new() -> Self {
    let state = Self {
      devices: Arc::new(Mutex::new(HashMap::new())),
      connection: Arc::new(Mutex::new(None)),
    };
    spawn_discovery_listener(state.devices.clone());
    state
  }

  pub fn shutdown(&self) {
    if let Ok(mut current) = self.connection.lock() {
      if let Some(connection) = current.take() {
        let _ = http_json(connection.socket, "/clear", &json!({ "protocol": "nstrans-tv-v1", "token": connection.token }));
      }
    }
  }
}

fn now_ms() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn spawn_discovery_listener(devices: Arc<Mutex<HashMap<String, TvDevice>>>) {
  thread::Builder::new().name("nstrans-tv-discovery".into()).spawn(move || {
    let socket = match UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)) {
      Ok(socket) => socket,
      Err(error) => {
        log::warn!("Unable to listen for NSTrans TV receivers: {error}");
        return;
      }
    };
    let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buffer = [0_u8; 2048];
    loop {
      if let Ok((length, peer)) = socket.recv_from(&mut buffer) {
        if let Ok(announcement) = serde_json::from_slice::<Announcement>(&buffer[..length]) {
          if announcement.protocol != "nstrans-tv-v1" || announcement.id.trim().is_empty() { continue; }
          let device = TvDevice {
            id: announcement.id.clone(),
            name: announcement.name,
            address: peer.ip().to_string(),
            port: announcement.port.unwrap_or(RECEIVER_PORT),
            last_seen_ms: now_ms(),
          };
          if let Ok(mut known) = devices.lock() { known.insert(announcement.id, device); }
        }
      }
      if let Ok(mut known) = devices.lock() {
        let cutoff = now_ms().saturating_sub(DEVICE_TTL_MS);
        known.retain(|_, device| device.last_seen_ms >= cutoff);
      }
    }
  }).ok();
}

fn resolve_receiver(input: &str) -> Result<(String, SocketAddr), String> {
  let value = input.trim().trim_start_matches("http://").trim_start_matches("https://").split('/').next().unwrap_or("");
  if value.is_empty() { return Err("请输入电视客户端 IP 地址".into()); }
  let endpoint = if value.rsplit_once(':').is_some_and(|(_, port)| port.parse::<u16>().is_ok()) { value.to_string() } else { format!("{value}:{RECEIVER_PORT}") };
  let socket = endpoint.to_socket_addrs().map_err(|error| format!("无法解析电视地址：{error}"))?.next().ok_or_else(|| "无法解析电视地址".to_string())?;
  Ok((endpoint, socket))
}

fn http_json(socket: SocketAddr, path: &str, body: &Value) -> Result<Value, String> {
  let body = serde_json::to_vec(body).map_err(|error| error.to_string())?;
  let mut stream = TcpStream::connect_timeout(&socket, Duration::from_secs(3)).map_err(|error| format!("无法连接电视客户端：{error}"))?;
  stream.set_read_timeout(Some(Duration::from_secs(4))).map_err(|error| error.to_string())?;
  stream.set_write_timeout(Some(Duration::from_secs(4))).map_err(|error| error.to_string())?;
  let request = format!(
    "POST {path} HTTP/1.1\r\nHost: {socket}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
    body.len()
  );
  stream.write_all(request.as_bytes()).and_then(|_| stream.write_all(&body)).map_err(|error| format!("发送字幕失败：{error}"))?;
  let mut response = Vec::new();
  stream.take((MAX_RESPONSE_BYTES + 1) as u64).read_to_end(&mut response).map_err(|error| format!("读取电视响应失败：{error}"))?;
  if response.len() > MAX_RESPONSE_BYTES { return Err("电视客户端响应过大".into()); }
  let split = response.windows(4).position(|window| window == b"\r\n\r\n").ok_or_else(|| "电视客户端返回了无效 HTTP 响应".to_string())?;
  let header = String::from_utf8_lossy(&response[..split]);
  if !header.lines().next().unwrap_or("").contains(" 200 ") {
    return Err(format!("电视客户端拒绝请求：{}", header.lines().next().unwrap_or("未知状态")));
  }
  serde_json::from_slice(&response[split + 4..]).map_err(|error| format!("无法解析电视响应：{error}"))
}

fn status(connection: Option<&TvConnection>) -> TvConnectionStatus {
  TvConnectionStatus {
    connected: connection.is_some(),
    name: connection.map(|value| value.name.clone()),
    address: connection.map(|value| value.address.clone()),
  }
}

#[tauri::command]
pub fn tv_cast_devices(state: tauri::State<'_, TvCastState>) -> Vec<TvDevice> {
  let cutoff = now_ms().saturating_sub(DEVICE_TTL_MS);
  let mut result = state.devices.lock().map(|known| known.values().filter(|device| device.last_seen_ms >= cutoff).cloned().collect::<Vec<_>>()).unwrap_or_default();
  result.sort_by(|left, right| left.name.cmp(&right.name));
  result
}

#[tauri::command]
pub fn tv_cast_connect(state: tauri::State<'_, TvCastState>, address: String) -> Result<TvConnectionStatus, String> {
  let (endpoint, socket) = resolve_receiver(&address)?;
  let response = http_json(socket, "/handshake", &json!({ "protocol": "nstrans-tv-v1", "controller": "NSTrans" }))?;
  if response.get("protocol").and_then(Value::as_str) != Some("nstrans-tv-v1") { return Err("目标不是兼容的 NSTrans 电视客户端".into()); }
  if response.get("overlayPermission").and_then(Value::as_bool) == Some(false) { return Err("电视客户端尚未获得悬浮窗权限".into()); }
  let token = response.get("token").and_then(Value::as_str).filter(|value| !value.is_empty()).ok_or_else(|| "电视客户端未返回握手令牌".to_string())?.to_string();
  let connection = TvConnection {
    name: response.get("name").and_then(Value::as_str).unwrap_or("Android TV").to_string(),
    address: endpoint,
    socket,
    token,
  };
  let result = status(Some(&connection));
  *state.connection.lock().map_err(|_| "无法保存电视连接".to_string())? = Some(connection);
  Ok(result)
}

#[tauri::command]
pub fn tv_cast_status(state: tauri::State<'_, TvCastState>) -> TvConnectionStatus {
  let connection = state.connection.lock().ok().and_then(|connection| connection.clone());
  status(connection.as_ref())
}

#[tauri::command]
pub fn tv_cast_push(state: tauri::State<'_, TvCastState>, mut payload: Value) -> Result<TvConnectionStatus, String> {
  let connection = state.connection.lock().map_err(|_| "无法读取电视连接".to_string())?.clone().ok_or_else(|| "尚未连接电视客户端".to_string())?;
  let object = payload.as_object_mut().ok_or_else(|| "字幕数据格式无效".to_string())?;
  object.insert("protocol".into(), Value::String("nstrans-tv-v1".into()));
  object.insert("token".into(), Value::String(connection.token.clone()));
  http_json(connection.socket, "/overlay", &payload)?;
  Ok(status(Some(&connection)))
}

#[tauri::command]
pub fn tv_cast_disconnect(state: tauri::State<'_, TvCastState>) -> Result<TvConnectionStatus, String> {
  state.shutdown();
  Ok(status(None))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn appends_default_receiver_port() {
    let (endpoint, socket) = resolve_receiver("127.0.0.1").unwrap();
    assert_eq!(endpoint, "127.0.0.1:38471");
    assert_eq!(socket.port(), RECEIVER_PORT);
  }

  #[test]
  fn accepts_http_and_custom_port() {
    let (endpoint, socket) = resolve_receiver("http://127.0.0.1:4000/receiver").unwrap();
    assert_eq!(endpoint, "127.0.0.1:4000");
    assert_eq!(socket.port(), 4000);
  }
}
