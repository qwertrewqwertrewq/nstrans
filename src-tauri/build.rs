fn main() {
  println!("cargo:rerun-if-env-changed=NSTRANS_BUILD_ATTESTATION");
  println!("cargo:rerun-if-env-changed=TAURI_NSTRANS_BUILD_ATTESTATION");
  tauri_build::build()
}
