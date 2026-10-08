// Tauri's mobile build bridge only forwards TAURI*, WRY*, CARGO_* and RUST_*.
// Keep the existing CI variable, but carry its public signed proof through that bridge.
export function clientBuildEnvironment(env = process.env) {
  return {
    ...env,
    ...(env.NSTRANS_BUILD_ATTESTATION !== undefined
      ? { TAURI_NSTRANS_BUILD_ATTESTATION: env.NSTRANS_BUILD_ATTESTATION }
      : {}),
  }
}
