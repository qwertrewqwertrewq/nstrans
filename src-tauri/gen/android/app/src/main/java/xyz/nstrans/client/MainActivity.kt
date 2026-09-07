package xyz.nstrans.client

import android.os.Bundle
import android.os.Process
import androidx.activity.enableEdgeToEdge
import java.io.File
import java.nio.ByteBuffer

class MainActivity : TauriActivity() {
  private fun recoverStaleWebViewLock() {
    val lock = File(applicationInfo.dataDir, "app_webview/webview_data.lock")
    if (!lock.isFile || lock.length() < 4) return
    val ownerPid = runCatching {
      val bytes = ByteArray(4)
      lock.inputStream().use { require(it.read(bytes) == bytes.size); ByteBuffer.wrap(bytes).getInt() }
    }.getOrNull() ?: return
    if (ownerPid <= 0 || ownerPid == Process.myPid()) return
    val state = runCatching {
      // /proc/<pid>/stat is "pid (name) STATE ...". Android can leave a killed
      // heavyweight process as a zombie briefly; WebView mistakes that zombie
      // for a live lock owner and crashes every replacement process at startup.
      File("/proc/$ownerPid/stat").readText().substringAfterLast(") ").firstOrNull()
    }.getOrNull()
    if (state == null || state == 'Z') lock.delete()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    recoverStaleWebViewLock()
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
