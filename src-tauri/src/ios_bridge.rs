use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::OnceLock;

type FreeString = unsafe extern "C" fn(*mut c_char);
type VisionOCR = unsafe extern "C" fn(*const u8, usize) -> *mut c_char;
type NoArgumentJSON = unsafe extern "C" fn() -> *mut c_char;
type OpenUSB = unsafe extern "C" fn(*const c_char) -> *mut c_char;
type PickModel = unsafe extern "C" fn(*const c_char) -> *mut c_char;

#[derive(Clone, Copy)]
struct IOSBridge {
  free_string: FreeString,
  vision_ocr: VisionOCR,
  usb_devices: NoArgumentJSON,
  usb_open: OpenUSB,
  usb_close: NoArgumentJSON,
  usb_frame: NoArgumentJSON,
  pick_model: PickModel,
}

static BRIDGE: OnceLock<IOSBridge> = OnceLock::new();

/// Swift registers its native functions before Tauri starts. Keeping only
/// function pointers here lets Cargo build without unresolved Swift symbols.
#[no_mangle]
pub extern "C" fn nstrans_register_ios_bridge(
  free_string: FreeString,
  vision_ocr: VisionOCR,
  usb_devices: NoArgumentJSON,
  usb_open: OpenUSB,
  usb_close: NoArgumentJSON,
  usb_frame: NoArgumentJSON,
  pick_model: PickModel,
) {
  let _ = BRIDGE.set(IOSBridge { free_string, vision_ocr, usb_devices, usb_open, usb_close, usb_frame, pick_model });
}

fn bridge() -> Result<IOSBridge, String> {
  BRIDGE.get().copied().ok_or_else(|| "iOS 原生接口尚未初始化".to_string())
}

unsafe fn take_json(bridge: IOSBridge, pointer: *mut c_char) -> Result<serde_json::Value, String> {
  if pointer.is_null() { return Err("iOS 原生接口没有返回结果".into()); }
  let value = CStr::from_ptr(pointer).to_string_lossy().into_owned();
  (bridge.free_string)(pointer);
  let json: serde_json::Value = serde_json::from_str(&value).map_err(|error| format!("无法解析 iOS 原生结果：{error}"))?;
  if let Some(error) = json.get("error").and_then(|item| item.as_str()) { return Err(error.to_string()); }
  Ok(json)
}

pub fn recognize(image: &[u8]) -> Result<serde_json::Value, String> {
  let bridge = bridge()?;
  unsafe { take_json(bridge, (bridge.vision_ocr)(image.as_ptr(), image.len())) }
}

pub fn usb_devices() -> Result<serde_json::Value, String> {
  let bridge = bridge()?;
  unsafe { take_json(bridge, (bridge.usb_devices)()) }
}

pub fn open_usb_camera(device_id: &str) -> Result<serde_json::Value, String> {
  let bridge = bridge()?;
  let device_id = CString::new(device_id).map_err(|_| "USB 设备标识无效".to_string())?;
  unsafe { take_json(bridge, (bridge.usb_open)(device_id.as_ptr())) }
}

pub fn close_usb_camera() -> Result<(), String> {
  let bridge = bridge()?;
  unsafe { take_json(bridge, (bridge.usb_close)()).map(|_| ()) }
}

pub fn usb_frame() -> Result<serde_json::Value, String> {
  let bridge = bridge()?;
  unsafe { take_json(bridge, (bridge.usb_frame)()) }
}

pub fn pick_model(destination: &std::path::Path) -> Result<serde_json::Value, String> {
  let bridge = bridge()?;
  let destination = CString::new(destination.to_string_lossy().as_bytes()).map_err(|_| "模型保存路径无效".to_string())?;
  unsafe { take_json(bridge, (bridge.pick_model)(destination.as_ptr())) }
}
