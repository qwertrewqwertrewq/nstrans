use serde::{Deserialize, Serialize};
use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, AppHandle, Manager, Runtime};

pub struct AndroidRuntime<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Clone for AndroidRuntime<R> {
  fn clone(&self) -> Self { Self(self.0.clone()) }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrPayload {
  image_base64: String,
  minimum_confidence: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsbCameraPayload { device_id: String }

#[derive(Deserialize)]
pub struct OcrResponse {
  pub regions: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPickerResponse {
  pub available: bool,
  pub cancelled: bool,
  pub error: Option<String>,
}

#[derive(Deserialize)]
struct UsbDevicesResponse { devices: Vec<serde_json::Value> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsbOpenResponse {
  available: bool,
  width: Option<u32>,
  height: Option<u32>,
  label: Option<String>,
  error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsbFrameResponse {
  image_base64: String,
  width: u32,
  height: u32,
  timestamp: u64,
}

impl<R: Runtime> AndroidRuntime<R> {
  pub fn recognize(&self, image_base64: String, minimum_confidence: f64) -> Result<serde_json::Value, String> {
    let response = self.0.run_mobile_plugin::<OcrResponse>("ocr", OcrPayload {
      image_base64,
      minimum_confidence,
    }).map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "regions": response.regions }))
  }

  pub fn unload_ocr(&self) -> Result<(), String> {
    self.0.run_mobile_plugin::<serde_json::Value>("unloadOcr", ())
      .map(|_| ()).map_err(|error| error.to_string())
  }

  pub fn pick_model(&self) -> Result<ModelPickerResponse, String> {
    self.0.run_mobile_plugin::<ModelPickerResponse>("pickModel", ())
      .map_err(|error| error.to_string())
  }

  pub fn usb_devices(&self) -> Result<serde_json::Value, String> {
    let response = self.0.run_mobile_plugin::<UsbDevicesResponse>("usbDevices", ())
      .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "devices": response.devices }))
  }

  pub fn open_usb_camera(&self, device_id: String) -> Result<serde_json::Value, String> {
    let response = self.0.run_mobile_plugin::<UsbOpenResponse>("openUsbCamera", UsbCameraPayload { device_id })
      .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "available": response.available, "width": response.width, "height": response.height, "label": response.label, "error": response.error }))
  }

  pub fn close_usb_camera(&self) -> Result<(), String> {
    self.0.run_mobile_plugin::<serde_json::Value>("closeUsbCamera", ())
      .map(|_| ()).map_err(|error| error.to_string())
  }

  pub fn usb_frame(&self) -> Result<serde_json::Value, String> {
    let response = self.0.run_mobile_plugin::<UsbFrameResponse>("usbFrame", ())
      .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "imageBase64": response.image_base64, "width": response.width, "height": response.height, "timestamp": response.timestamp }))
  }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("nstrans-runtime")
    .setup(|app: &AppHandle<R>, api| {
      let handle = api.register_android_plugin("xyz.nstrans.client", "NstransRuntimePlugin")?;
      app.manage(AndroidRuntime(handle));
      Ok(())
    })
    .build()
}
