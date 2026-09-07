use encoding_rs::UTF_8;
use llama_cpp_2::{
  context::params::LlamaContextParams,
  llama_backend::LlamaBackend,
  llama_batch::LlamaBatch,
  model::{params::{kv_overrides::ParamOverrideValue, LlamaModelParams}, AddBos, LlamaModel},
  sampling::LlamaSampler,
};
use std::{num::NonZeroU32, path::{Path, PathBuf}};

pub struct MobileLlm {
  model: Option<LlamaModel>,
  model_path: Option<PathBuf>,
  backend: LlamaBackend,
}

impl MobileLlm {
  pub fn new() -> Result<Self, String> {
    // Keep llama.cpp diagnostics enabled on Android. Model loading collapses
    // many distinct native failures into `NullResult`; logcat is the only
    // reliable place to retain the actionable cause (unsupported GGUF,
    // allocation failure, tensor mismatch, and so on).
    let backend = LlamaBackend::init().map_err(|error| format!("初始化 llama.cpp 失败：{error}"))?;
    Ok(Self { model: None, model_path: None, backend })
  }

  pub fn unload(&mut self) {
    self.model = None;
    self.model_path = None;
  }

  fn load(&mut self, path: &Path) -> Result<(), String> {
    if self.model.is_some() && self.model_path.as_deref() == Some(path) { return Ok(()); }
    let gpu_layers = if cfg!(target_os = "ios") { 999 } else { 0 };
    let mut params = Box::pin(LlamaModelParams::default().with_n_gpu_layers(gpu_layers));
    // Ollama's official TranslateGemma blob omits this text-model field and
    // relies on its patched Gemma 3 loader to supply the architectural default.
    // Upstream llama.cpp requires it. A model-parameter override supplies the
    // same 1e-6 value without rewriting or duplicating the multi-gigabyte GGUF.
    params.as_mut().append_kv_override(
      c"gemma3.attention.layer_norm_rms_epsilon",
      ParamOverrideValue::Float(1.0e-6),
    );
    self.model = Some(LlamaModel::load_from_file(&self.backend, path, &params)
      .map_err(|error| format!("加载 TranslateGemma GGUF 失败：{error}"))?);
    self.model_path = Some(path.to_path_buf());
    Ok(())
  }

  pub fn generate(&mut self, path: &Path, prompt: &str) -> Result<String, String> {
    self.load(path)?;
    let model = self.model.as_ref().ok_or("TranslateGemma 模型未加载")?;
    let max_threads = if cfg!(target_os = "ios") { 6 } else { 4 };
    let threads = std::thread::available_parallelism().map_or(2, |value| value.get().saturating_sub(1).clamp(2, max_threads)) as i32;
    let formatted = format!("<start_of_turn>user\n{prompt}<end_of_turn>\n<start_of_turn>model\n");
    let tokens = model.str_to_token(&formatted, AddBos::Always)
      .map_err(|error| format!("TranslateGemma 分词失败：{error}"))?;
    if tokens.is_empty() { return Err("TranslateGemma 输入为空".into()); }
    // Batch translation can contain several short UI labels. Generation still
    // stops at EOG, so a larger ceiling costs no extra work for a short result.
    const MAX_OUTPUT: usize = 512;
    // A fixed 4096-token context allocated more than 500 MiB for every text
    // region. Most game labels need 1024 tokens or less, so size the context to
    // the actual prompt while retaining headroom for long dialogue/history.
    let required = tokens.len().saturating_add(MAX_OUTPUT).saturating_add(32);
    // Keep 8 GB iPads below their dynamic per-process memory ceiling.
    let context_limit = if cfg!(target_os = "ios") { 2048 } else { 4096 };
    let context_size = required.next_power_of_two().clamp(1024, context_limit);
    if required > context_size { return Err("翻译上下文过长，请重置对话后重试".into()); }
    let params = LlamaContextParams::default()
      .with_n_ctx(NonZeroU32::new(context_size as u32))
      // 256 keeps llama.cpp's temporary compute graph materially smaller on
      // phones. Longer prompts are transparently evaluated in multiple chunks.
      .with_n_batch(context_size.min(if cfg!(target_os = "ios") { 128 } else { 256 }) as u32)
      .with_n_threads(threads)
      .with_n_threads_batch(threads);
    let mut context = model.new_context(&self.backend, params)
      .map_err(|error| format!("创建 TranslateGemma 上下文失败：{error}"))?;

    let batch_size = context_size.min(if cfg!(target_os = "ios") { 128 } else { 256 });
    let mut batch = LlamaBatch::new(batch_size, 1);
    let last = tokens.len() - 1;
    for (chunk_index, chunk) in tokens.chunks(batch_size).enumerate() {
      batch.clear();
      let first_position = chunk_index * batch_size;
      for (offset, token) in chunk.iter().copied().enumerate() {
        let position = first_position + offset;
        batch.add(token, position as i32, &[0], position == last).map_err(|error| error.to_string())?;
      }
      context.decode(&mut batch).map_err(|error| format!("TranslateGemma 预填充失败：{error}"))?;
    }
    let mut sampler = LlamaSampler::greedy();
    let mut decoder = UTF_8.new_decoder();
    let mut output = String::new();
    let mut position = tokens.len() as i32;
    for _ in 0..MAX_OUTPUT {
      let token = sampler.sample(&context, batch.n_tokens() - 1);
      sampler.accept(token);
      if model.is_eog_token(token) { break; }
      let piece = model.token_to_piece(token, &mut decoder, true, None).map_err(|error| error.to_string())?;
      output.push_str(&piece);
      if output.contains("<end_of_turn>") { break; }
      batch.clear();
      batch.add(token, position, &[0], true).map_err(|error| error.to_string())?;
      position += 1;
      context.decode(&mut batch).map_err(|error| format!("TranslateGemma 解码失败：{error}"))?;
    }
    let translation = output.split("<end_of_turn>").next().unwrap_or("").trim().trim_matches(['\'', '"']).trim().to_string();
    if translation.is_empty() { Err("TranslateGemma 没有返回译文".into()) } else { Ok(translation) }
  }
}
