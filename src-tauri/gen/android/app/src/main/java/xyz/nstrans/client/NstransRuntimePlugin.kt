package xyz.nstrans.client

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.YuvImage
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.SystemClock
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import com.herohan.uvcapp.CameraException
import com.herohan.uvcapp.CameraHelper
import com.herohan.uvcapp.ICameraHelper
import com.serenegiant.usb.UVCCamera
import com.serenegiant.utils.UVCUtils
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

@InvokeArg
internal class OcrArgs {
    lateinit var imageBase64: String
    var minimumConfidence: Double = 0.0
}

@InvokeArg
internal class UsbCameraArgs {
    lateinit var deviceId: String
}

private data class Rect(var x0: Int, var y0: Int, var x1: Int, var y1: Int)
private data class TextBox(val box: Rect)
private data class CropMeta(val sourceIndex: Int, val box: Rect, val effectiveWidth: Int, val effectiveHeight: Int, val vertical: Boolean)
private data class Candidate(val text: String, val box: Rect, var confidence: Float, val start: Int, val end: Int)
private data class Region(val source: String, val confidence: Double, val box: Rect)
private data class FrameSnapshot(val bytes: ByteArray, val width: Int, val height: Int, val timestamp: Long)

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.CAMERA], alias = "camera")])
class NstransRuntimePlugin(private val activity: Activity) : Plugin(activity) {
    private companion object {
        const val TAG = "NSTrans-UVC"
        const val USB_PERMISSION_ACTION = "xyz.nstrans.client.USB_PERMISSION"
    }
    // Frame compression must never wait behind the much heavier ONNX OCR pass.
    // Keeping these queues separate makes the UVC preview responsive while OCR
    // is running and also prevents a model import from starving live video.
    private val frameWorker = Executors.newSingleThreadExecutor()
    private val ocrWorker = Executors.newSingleThreadExecutor()
    private val fileWorker = Executors.newSingleThreadExecutor()
    @Volatile private var engine: MeikiAndroidEngine? = null
    private val frameLock = Any()
    @Volatile private var cameraHelper: ICameraHelper? = null
    @Volatile private var activeUsbDevice: UsbDevice? = null
    @Volatile private var usbWidth = 0
    @Volatile private var usbHeight = 0
    @Volatile private var usbOpened = false
    private var latestNv21: ByteArray? = null
    private var latestFrameAt = 0L
    private var pendingCameraOpen: Invoke? = null
    private var usbPermissionReceiver: BroadcastReceiver? = null
    @Volatile private var failedUsbDeviceName: String? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    private val cameraStateCallback = object : ICameraHelper.StateCallback {
        override fun onAttach(device: UsbDevice) {
            if (device.deviceName != activeUsbDevice?.deviceName || pendingCameraOpen == null) return
            // CameraHelper binds its connection service asynchronously. Calling
            // selectDevice immediately after construction can happen before that
            // service exists and the library silently drops the request. The
            // initial attach callback is delivered after the service is ready.
            Log.i(TAG, "UVC service ready for ${usbDeviceLabel(device)}")
            cameraHelper?.selectDevice(device)
        }

        override fun onDeviceOpen(device: UsbDevice, isFirstOpen: Boolean) {
            if (device.deviceName == activeUsbDevice?.deviceName) cameraHelper?.openCamera()
        }

        override fun onCameraOpen(device: UsbDevice) {
            if (device.deviceName != activeUsbDevice?.deviceName) return
            val helper = cameraHelper ?: return
            val size = helper.previewSize
            usbWidth = size?.width ?: 640
            usbHeight = size?.height ?: 480
            helper.startPreview()
            helper.setFrameCallback({ frame ->
                val now = SystemClock.elapsedRealtime()
                if (now - latestFrameAt < 50) return@setFrameCallback
                synchronized(frameLock) {
                    frame.rewind()
                    val length = frame.remaining()
                    val target = latestNv21?.takeIf { it.size == length } ?: ByteArray(length).also { latestNv21 = it }
                    frame.get(target)
                    latestFrameAt = now
                }
            }, UVCCamera.PIXEL_FORMAT_NV21)
            usbOpened = true
            failedUsbDeviceName = null
            Log.i(TAG, "Opened ${usbDeviceLabel(device)} at ${usbWidth}x${usbHeight}")
            pendingCameraOpen?.resolveObject(mapOf(
                "available" to true,
                "width" to usbWidth,
                "height" to usbHeight,
                "label" to usbDeviceLabel(device),
                "error" to null,
            ))
            pendingCameraOpen = null
        }

        override fun onCameraClose(device: UsbDevice) { if (device.deviceName == activeUsbDevice?.deviceName) usbOpened = false }
        override fun onDeviceClose(device: UsbDevice) = Unit

        override fun onDetach(device: UsbDevice) {
            if (device.deviceName != activeUsbDevice?.deviceName) return
            usbOpened = false
            synchronized(frameLock) { latestNv21 = null }
            pendingCameraOpen?.reject("USB 采集卡已断开")
            pendingCameraOpen = null
            failedUsbDeviceName = null
            Log.w(TAG, "Detached ${usbDeviceLabel(device)}")
        }

        override fun onCancel(device: UsbDevice) {
            if (device.deviceName != activeUsbDevice?.deviceName) return
            pendingCameraOpen?.reject("未授予 USB 采集卡访问权限")
            pendingCameraOpen = null
            Log.w(TAG, "USB permission cancelled for ${usbDeviceLabel(device)}")
        }

        override fun onError(device: UsbDevice, error: CameraException) {
            usbOpened = false
            pendingCameraOpen?.reject("无法打开 USB 采集卡：${error.message ?: error.code}")
            pendingCameraOpen = null
            Log.e(TAG, "Camera error ${error.code}: ${error.message}")
        }
    }

    init { UVCUtils.init(activity.applicationContext) }

    private fun isVideoDevice(device: UsbDevice): Boolean = (0 until device.interfaceCount).any {
        device.getInterface(it).interfaceClass == UsbConstants.USB_CLASS_VIDEO
    }

    private fun usbDeviceLabel(device: UsbDevice): String = listOfNotNull(device.productName, device.manufacturerName)
        .firstOrNull { it.isNotBlank() } ?: "USB 视频设备 ${device.vendorId}:${device.productId}"

    private fun findUsbDevice(deviceId: String): UsbDevice? {
        val manager = activity.getSystemService(Activity.USB_SERVICE) as UsbManager
        return manager.deviceList.values.firstOrNull { isVideoDevice(it) && it.deviceName == deviceId }
    }

    @Command
    fun usbDevices(invoke: Invoke) {
        try {
            val manager = activity.getSystemService(Activity.USB_SERVICE) as UsbManager
            val devices = manager.deviceList.values.filter(::isVideoDevice).map { device -> mapOf(
                "id" to device.deviceName,
                "label" to usbDeviceLabel(device),
                "vendorId" to device.vendorId,
                "productId" to device.productId,
                "connected" to true,
            ) }
            Log.i(TAG, "Enumerated ${devices.size} UVC device(s)")
            invoke.resolveObject(mapOf("devices" to devices))
        } catch (error: Throwable) {
            invoke.reject("无法枚举 USB 视频设备：${error.message ?: error.javaClass.simpleName}")
        }
    }

    @Command
    fun openUsbCamera(invoke: Invoke) {
        // Android requires CAMERA before it will grant access to USB video-class
        // devices. A fresh install therefore needs this prompt before UVCAndroid
        // can show its own per-device USB permission dialog.
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("camera", invoke, "onCameraPermissionResult")
            return
        }
        openUsbCameraAfterPermission(invoke)
    }

    @PermissionCallback
    fun onCameraPermissionResult(invoke: Invoke) {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            invoke.reject("未授予相机权限；Android 需要先允许相机权限才能访问 USB 采集卡")
            return
        }
        openUsbCameraAfterPermission(invoke)
    }

    private fun openUsbCameraAfterPermission(invoke: Invoke) {
        val args = invoke.parseArgs(UsbCameraArgs::class.java)
        val device = findUsbDevice(args.deviceId)
        if (device == null) { invoke.reject("USB 视频设备已断开"); return }
        if (failedUsbDeviceName == device.deviceName) {
            invoke.reject("系统 USB 驱动未能打开此采集卡，请重新插拔采集卡后再试")
            return
        }
        val manager = activity.getSystemService(Activity.USB_SERVICE) as UsbManager
        Log.i(TAG, "Opening ${usbDeviceLabel(device)}; system permission=${manager.hasPermission(device)}")
        if (!manager.hasPermission(device)) {
            closeUsbCameraInternal()
            activeUsbDevice = device
            pendingCameraOpen = invoke
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    if (intent?.action != USB_PERMISSION_ACTION || pendingCameraOpen !== invoke) return
                    clearUsbPermissionReceiver()
                    if (!intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                        pendingCameraOpen = null
                        activeUsbDevice = null
                        invoke.reject("未授予 USB 采集卡访问权限")
                        return
                    }
                    Log.i(TAG, "System USB permission granted for ${usbDeviceLabel(device)}")
                    initializeUsbCamera(invoke, device)
                }
            }
            usbPermissionReceiver = receiver
            ContextCompat.registerReceiver(activity, receiver, IntentFilter(USB_PERMISSION_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            val permissionIntent = PendingIntent.getBroadcast(activity, 0, Intent(USB_PERMISSION_ACTION).setPackage(activity.packageName), flags)
            manager.requestPermission(device, permissionIntent)
            mainHandler.postDelayed({
                if (pendingCameraOpen === invoke && cameraHelper == null) {
                    pendingCameraOpen = null
                    clearUsbPermissionReceiver()
                    activeUsbDevice = null
                    invoke.reject("等待 USB 采集卡授权超时，请重新选择输入源")
                }
            }, 20_000)
            return
        }
        initializeUsbCamera(invoke, device)
    }

    private fun initializeUsbCamera(invoke: Invoke, device: UsbDevice) {
        try {
            // Do not reject the same pending invocation while moving from the
            // explicit system permission stage into UVCAndroid initialization.
            pendingCameraOpen = null
            closeUsbCameraInternal()
            activeUsbDevice = device
            pendingCameraOpen = invoke
            cameraHelper = CameraHelper().also {
                it.setStateCallback(cameraStateCallback)
                it.selectDevice(device)
            }
            // Some vendor builds do not replay onAttach for devices that were
            // already connected. Retry once after service binding settles.
            mainHandler.postDelayed({
                if (pendingCameraOpen === invoke && !usbOpened) cameraHelper?.selectDevice(device)
            }, 750)
            mainHandler.postDelayed({
                if (pendingCameraOpen === invoke) {
                    pendingCameraOpen = null
                    // UsbManager.openDevice can become stuck in uninterruptible
                    // kernel I/O on a malformed/busy UVC device. Do not create
                    // another CameraHelper (and another blocked thread) until a
                    // physical detach proves that the device was reset.
                    failedUsbDeviceName = device.deviceName
                    invoke.reject("打开 USB 采集卡超时，请重新插拔设备并确认 USB 授权")
                }
            }, 20_000)
        } catch (error: Throwable) {
            pendingCameraOpen = null
            invoke.reject("无法初始化 USB 采集卡：${error.message ?: error.javaClass.simpleName}")
        }
    }

    private fun clearUsbPermissionReceiver() {
        val receiver = usbPermissionReceiver ?: return
        usbPermissionReceiver = null
        runCatching { activity.unregisterReceiver(receiver) }
    }

    @Command
    fun closeUsbCamera(invoke: Invoke) {
        closeUsbCameraInternal()
        invoke.resolveObject(mapOf("available" to false))
    }

    private fun closeUsbCameraInternal() {
        clearUsbPermissionReceiver()
        usbOpened = false
        pendingCameraOpen?.reject("USB 采集卡打开操作已取消")
        pendingCameraOpen = null
        cameraHelper?.setFrameCallback(null, 0)
        cameraHelper?.closeCamera()
        cameraHelper?.release()
        cameraHelper = null
        activeUsbDevice = null
        usbWidth = 0; usbHeight = 0; latestFrameAt = 0
        synchronized(frameLock) { latestNv21 = null }
    }

    @Command
    fun usbFrame(invoke: Invoke) {
        if (!usbOpened) { invoke.reject("USB 采集卡尚未打开"); return }
        frameWorker.execute {
            try {
                val snapshot = synchronized(frameLock) {
                    val frame = latestNv21 ?: throw IllegalStateException("正在等待 USB 采集卡画面")
                    val width = usbWidth; val height = usbHeight
                    require(width > 0 && height > 0 && frame.size >= width * height * 3 / 2) { "USB 采集卡帧尺寸无效" }
                    FrameSnapshot(frame.copyOf(), width, height, latestFrameAt)
                }
                val output = ByteArrayOutputStream()
                // JPEG encoding a 1080p frame can take tens of milliseconds.
                // Keep it outside frameLock so the UVC callback can continue
                // replacing the latest frame instead of stalling capture.
                YuvImage(snapshot.bytes, ImageFormat.NV21, snapshot.width, snapshot.height, null)
                    .compressToJpeg(android.graphics.Rect(0, 0, snapshot.width, snapshot.height), 84, output)
                val result = mapOf(
                    "imageBase64" to Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP),
                    "width" to snapshot.width,
                    "height" to snapshot.height,
                    "timestamp" to snapshot.timestamp,
                )
                invoke.resolveObject(result)
            } catch (error: Throwable) {
                invoke.reject(error.message ?: "无法读取 USB 采集卡画面")
            }
        }
    }

    @Command
    fun ocr(invoke: Invoke) {
        val args = invoke.parseArgs(OcrArgs::class.java)
        ocrWorker.execute {
            try {
                val bytes = Base64.decode(args.imageBase64, Base64.DEFAULT)
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    ?: throw IllegalArgumentException("无法解码 OCR 图像")
                val active = engine ?: synchronized(this) {
                    engine ?: MeikiAndroidEngine(activity).also { engine = it }
                }
                val regions = active.run(bitmap).filter { it.confidence >= args.minimumConfidence }
                bitmap.recycle()
                invoke.resolveObject(mapOf("regions" to regions.mapIndexed { index, region -> mapOf(
                    "id" to "meiki-android-$index",
                    "source" to region.source,
                    "translated" to "",
                    "confidence" to region.confidence,
                    "box" to mapOf("x0" to region.box.x0, "y0" to region.box.y0, "x1" to region.box.x1, "y1" to region.box.y1),
                    "fontFamily" to "sans",
                ) }))
            } catch (error: Throwable) {
                invoke.reject("Android MeikiOCR 失败：${error.message ?: error.javaClass.simpleName}")
            }
        }
    }

    @Command
    fun unloadOcr(invoke: Invoke) {
        // Serialize teardown behind any active inference; closing an ORT session
        // from another thread while run() is active is unsafe.
        ocrWorker.execute {
            engine?.close()
            engine = null
            invoke.resolveObject(mapOf("available" to false))
        }
    }

    @Command
    fun pickModel(invoke: Invoke) {
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                // GGUF has no universally registered MIME type; filtering on
                // application/octet-stream hides it in several document providers.
                type = "*/*"
            }
            startActivityForResult(invoke, intent, "modelPickerResult")
        } catch (error: Throwable) {
            invoke.reject("无法打开 Android 模型选择器：${error.message ?: error.javaClass.simpleName}")
        }
    }

    @ActivityCallback
    fun modelPickerResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_CANCELED) {
            invoke.resolveObject(mapOf("available" to false, "cancelled" to true, "error" to null))
            return
        }
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolveObject(mapOf("available" to false, "cancelled" to false, "error" to "没有取得模型文件"))
            return
        }
        fileWorker.execute {
            val directory = File(activity.filesDir, "models/llama").apply { mkdirs() }
            val destination = File(directory, "translategemma-4b.gguf")
            val partial = File(directory, "translategemma-4b.gguf.part")
            try {
                var copied = 0L
                activity.contentResolver.openInputStream(uri).use { input ->
                    requireNotNull(input) { "无法读取所选模型" }
                    partial.outputStream().buffered().use { output ->
                        val buffer = ByteArray(1024 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            copied += count
                            require(copied <= 16L * 1024 * 1024 * 1024) { "模型文件超过 16GB 安全上限" }
                            output.write(buffer, 0, count)
                        }
                    }
                }
                require(copied >= 1024 * 1024) { "模型文件过小，不是有效的 GGUF" }
                partial.inputStream().use { input ->
                    val magic = ByteArray(4)
                    require(input.read(magic) == 4 && magic.contentEquals(byteArrayOf(0x47, 0x47, 0x55, 0x46))) { "文件不是 GGUF 模型" }
                }
                if (destination.exists() && !destination.delete()) throw IllegalStateException("无法替换旧模型")
                if (!partial.renameTo(destination)) throw IllegalStateException("无法保存模型")
                invoke.resolveObject(mapOf("available" to true, "cancelled" to false, "error" to null))
            } catch (error: Throwable) {
                partial.delete()
                invoke.resolveObject(mapOf("available" to false, "cancelled" to false, "error" to (error.message ?: error.javaClass.simpleName)))
            }
        }
    }

    override fun onDestroy() {
        closeUsbCameraInternal()
        engine?.close()
        engine = null
        frameWorker.shutdownNow()
        ocrWorker.shutdownNow()
        fileWorker.shutdownNow()
        super.onDestroy()
    }
}

private class MeikiAndroidEngine(activity: Activity) : AutoCloseable {
    companion object {
        private const val DET_WIDTH = 960
        private const val DET_HEIGHT = 544
        private const val REC_WIDTH = 960
        private const val REC_HEIGHT = 32
        private const val VREC_WIDTH = 32
        private const val VREC_HEIGHT = 480
        private const val MAX_BATCH = 8
        private const val DET_NAME = "meiki.text.detect.v0.1.960x544.onnx"
        private const val REC_NAME = "meiki.text.rec.v0.960x32.onnx"
        private const val VREC_NAME = "meiki.text.rec.v0.vertical.32x480.onnx"
        private val swaps = mapOf("儡傀" to "傀儡", "談冗" to "冗談", "汰淘" to "淘汰", "沱滂" to "滂沱", "攣痙" to "痙攣", "酊酩" to "酩酊", "麭麺" to "麺麭", "哭慟" to "慟哭")
    }

    private val environment = OrtEnvironment.getEnvironment("nstrans-meiki")
    private val options = OrtSession.SessionOptions().apply {
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        setIntraOpNumThreads(max(2, min(4, Runtime.getRuntime().availableProcessors() - 1)))
        setInterOpNumThreads(1)
    }
    private val modelDir = File(activity.filesDir, "models/meiki").apply { mkdirs() }
    private val det = environment.createSession(copyAsset(activity, DET_NAME).absolutePath, options)
    private val rec = environment.createSession(copyAsset(activity, REC_NAME).absolutePath, options)
    private val vrec = environment.createSession(copyAsset(activity, VREC_NAME).absolutePath, options)

    private fun copyAsset(activity: Activity, name: String): File {
        val target = File(modelDir, name)
        if (!target.exists() || target.length() < 1024 * 1024) {
            val partial = File(modelDir, "$name.part")
            activity.assets.open(name).use { input -> partial.outputStream().buffered().use { input.copyTo(it) } }
            if (target.exists()) target.delete()
            if (!partial.renameTo(target)) throw IllegalStateException("无法安装 MeikiOCR 模型 $name")
        }
        return target
    }

    fun run(bitmap: Bitmap): List<Region> {
        val primary = recognize(bitmap, .15f)
        val bottomX = (bitmap.width * .43f).roundToInt().coerceIn(0, bitmap.width - 1)
        val bottomY = (bitmap.height * .88f).roundToInt().coerceIn(0, bitmap.height - 1)
        val crop = Bitmap.createBitmap(bitmap, bottomX, bottomY, bitmap.width - bottomX, bitmap.height - bottomY)
        val enlarged = Bitmap.createScaledBitmap(crop, crop.width * 2, crop.height * 2, true)
        val detail = recognize(enlarged, .10f).map { region ->
            region.copy(box = Rect(bottomX + region.box.x0 / 2, bottomY + region.box.y0 / 2, bottomX + region.box.x1 / 2, bottomY + region.box.y1 / 2))
        }
        crop.recycle(); enlarged.recycle()
        return mergePasses(primary, detail)
    }

    private fun recognize(bitmap: Bitmap, recThreshold: Float): List<Region> {
        val boxes = detect(bitmap, .45f)
        if (boxes.isEmpty()) return emptyList()
        val results = arrayOfNulls<Region>(boxes.size)
        recognizeOrientation(bitmap, boxes, boxes.indices.filter { val b = boxes[it].box; b.x1 - b.x0 >= b.y1 - b.y0 }, false, recThreshold, results)
        recognizeOrientation(bitmap, boxes, boxes.indices.filter { val b = boxes[it].box; b.x1 - b.x0 < b.y1 - b.y0 }, true, recThreshold, results)
        return results.filterNotNull()
    }

    private fun detect(bitmap: Bitmap, threshold: Float): List<TextBox> {
        val scale = min(DET_WIDTH.toFloat() / bitmap.width, DET_HEIGHT.toFloat() / bitmap.height)
        val width = max(1, (bitmap.width * scale).toInt())
        val height = max(1, (bitmap.height * scale).toInt())
        val resized = Bitmap.createScaledBitmap(bitmap, width, height, true)
        val input = imageTensor(resized, DET_WIDTH, DET_HEIGHT)
        resized.recycle()
        OnnxTensor.createTensor(environment, FloatBuffer.wrap(input), longArrayOf(1, 3, DET_HEIGHT.toLong(), DET_WIDTH.toLong())).use { images ->
            OnnxTensor.createTensor(environment, LongBuffer.wrap(longArrayOf((DET_WIDTH / scale).toLong(), (DET_HEIGHT / scale).toLong())), longArrayOf(1, 2)).use { size ->
                det.run(mapOf("images" to images, "orig_target_sizes" to size)).use { output ->
                    @Suppress("UNCHECKED_CAST") val rawBoxes = (output[1].value as Array<Array<FloatArray>>)[0]
                    @Suppress("UNCHECKED_CAST") val scores = (output[2].value as Array<FloatArray>)[0]
                    return rawBoxes.indices.filter { scores[it] > threshold }.map { index ->
                        val b = rawBoxes[index]
                        TextBox(Rect(b[0].roundToInt().coerceIn(0, bitmap.width), b[1].roundToInt().coerceIn(0, bitmap.height), b[2].roundToInt().coerceIn(0, bitmap.width), b[3].roundToInt().coerceIn(0, bitmap.height)))
                    }.filter { it.box.x1 > it.box.x0 && it.box.y1 > it.box.y0 }.sortedBy { it.box.y0 }
                }
            }
        }
    }

    private fun recognizeOrientation(bitmap: Bitmap, boxes: List<TextBox>, indices: List<Int>, vertical: Boolean, threshold: Float, results: Array<Region?>) {
        val metas = mutableListOf<CropMeta>()
        val tensors = mutableListOf<FloatArray>()
        for (sourceIndex in indices) {
            val box = boxes[sourceIndex].box
            val crop = Bitmap.createBitmap(bitmap, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0)
            if (!vertical) {
                var newHeight = REC_HEIGHT
                var newWidth = (crop.width * (REC_HEIGHT.toFloat() / crop.height)).roundToInt()
                if (newWidth > REC_WIDTH) { newHeight = max(1, (newHeight * (REC_WIDTH.toFloat() / newWidth)).roundToInt()); newWidth = REC_WIDTH }
                val resized = Bitmap.createScaledBitmap(crop, max(1, newWidth), max(1, newHeight), true)
                tensors += imageTensor(resized, REC_WIDTH, REC_HEIGHT)
                metas += CropMeta(sourceIndex, box, newWidth, newHeight, false)
                resized.recycle()
            } else {
                val scale = VREC_WIDTH.toFloat() / crop.width
                val fullHeight = crop.height * scale
                val segments = mutableListOf<Pair<Int, Int>>()
                if (fullHeight > VREC_HEIGHT) {
                    val segmentHeight = 420f / scale
                    val stride = (420f - 64f) / scale
                    var y = 0f
                    while (y + segmentHeight < crop.height) { segments += y.roundToInt() to min(crop.height, (y + segmentHeight).roundToInt()); y += stride }
                    val last = max(0, (crop.height - segmentHeight).roundToInt())
                    if (segments.isEmpty() || last > segments.last().first + 1) segments += last to crop.height
                } else segments += 0 to crop.height
                for ((startY, endY) in segments) {
                    val segment = Bitmap.createBitmap(crop, 0, startY, crop.width, max(1, endY - startY))
                    val effectiveHeight = min(if (fullHeight > VREC_HEIGHT) 420 else VREC_HEIGHT, max(1, (segment.height * scale).roundToInt()))
                    val resized = Bitmap.createScaledBitmap(segment, VREC_WIDTH, effectiveHeight, true)
                    tensors += imageTensor(resized, VREC_WIDTH, VREC_HEIGHT)
                    metas += CropMeta(sourceIndex, Rect(box.x0, box.y0 + startY, box.x1, box.y0 + endY), VREC_WIDTH, effectiveHeight, true)
                    segment.recycle(); resized.recycle()
                }
            }
            crop.recycle()
        }
        for (start in tensors.indices step MAX_BATCH) {
            val end = min(tensors.size, start + MAX_BATCH)
            inferRecognition(tensors.subList(start, end), metas.subList(start, end), vertical, threshold, results)
        }
    }

    private fun inferRecognition(tensors: List<FloatArray>, metas: List<CropMeta>, vertical: Boolean, threshold: Float, results: Array<Region?>) {
        if (tensors.isEmpty()) return
        val width = if (vertical) VREC_WIDTH else REC_WIDTH
        val height = if (vertical) VREC_HEIGHT else REC_HEIGHT
        val combined = FloatArray(tensors.sumOf { it.size }); var offset = 0
        for (tensor in tensors) { tensor.copyInto(combined, offset); offset += tensor.size }
        val session = if (vertical) vrec else rec
        OnnxTensor.createTensor(environment, FloatBuffer.wrap(combined), longArrayOf(tensors.size.toLong(), 3, height.toLong(), width.toLong())).use { images ->
            OnnxTensor.createTensor(environment, LongBuffer.wrap(longArrayOf(width.toLong(), height.toLong())), longArrayOf(1, 2)).use { size ->
                session.run(mapOf("images" to images, "orig_target_sizes" to size)).use { output ->
                    @Suppress("UNCHECKED_CAST") val labels = output[0].value as Array<IntArray>
                    @Suppress("UNCHECKED_CAST") val boxes = output[1].value as Array<Array<FloatArray>>
                    @Suppress("UNCHECKED_CAST") val scores = output[2].value as Array<FloatArray>
                    val grouped = mutableMapOf<Int, MutableList<Candidate>>()
                    for (batch in metas.indices) {
                        val meta = metas[batch]; val target = grouped.getOrPut(meta.sourceIndex) { mutableListOf() }
                        for (index in labels[batch].indices) {
                            val confidence = scores[batch][index]
                            if (confidence < threshold) continue
                            val raw = boxes[batch][index]
                            val cropWidth = meta.box.x1 - meta.box.x0; val cropHeight = meta.box.y1 - meta.box.y0
                            if (!vertical && raw[0] >= meta.effectiveWidth || vertical && raw[1] >= meta.effectiveHeight) continue
                            val rx1 = min(raw[0], meta.effectiveWidth.toFloat()); val rx2 = min(raw[2], meta.effectiveWidth.toFloat())
                            val ry1 = min(raw[1], meta.effectiveHeight.toFloat()); val ry2 = min(raw[3], meta.effectiveHeight.toFloat())
                            // Recognition inputs are aspect-fitted into a padded
                            // tensor. Character coordinates are inside the fitted
                            // content, so map through its effective dimensions;
                            // dividing by the padded tensor size made long lines'
                            // boxes too narrow and visibly shifted up/left.
                            val xScale = meta.effectiveWidth
                            val x1 = meta.box.x0 + (rx1 / xScale * cropWidth).toInt(); val x2 = meta.box.x0 + (rx2 / xScale * cropWidth).toInt()
                            val yScale = meta.effectiveHeight
                            val y1 = meta.box.y0 + (ry1 / yScale * cropHeight).toInt(); val y2 = meta.box.y0 + (ry2 / yScale * cropHeight).toInt()
                            val text = String(Character.toChars(labels[batch][index]))
                            target += Candidate(text, Rect(x1, y1, x2, y2), confidence, if (vertical) y1 else x1, if (vertical) y2 else x2)
                        }
                    }
                    for ((sourceIndex, candidates) in grouped) results[sourceIndex] = finishLine(candidates)
                }
            }
        }
    }

    private fun finishLine(candidates: MutableList<Candidate>): Region? {
        candidates.sortByDescending { it.confidence }
        val accepted = mutableListOf<Candidate>()
        for (candidate in candidates) {
            val length = max(1f, (candidate.end - candidate.start).toFloat())
            val overlaps = accepted.any { other ->
                val intersection = max(0, min(candidate.end, other.end) - max(candidate.start, other.start))
                intersection / min(length, max(1f, (other.end - other.start).toFloat())) > .3f
            }
            if (!overlaps) accepted += candidate
        }
        accepted.sortBy { it.start }
        if (accepted.isEmpty()) return null
        var text = accepted.joinToString("") { it.text }
        for ((wrong, correct) in swaps) text = text.replace(wrong, correct)
        val box = Rect(accepted.minOf { it.box.x0 }, accepted.minOf { it.box.y0 }, accepted.maxOf { it.box.x1 }, accepted.maxOf { it.box.y1 })
        return Region(text, accepted.map { it.confidence.toDouble() }.average() * 100, box)
    }

    private fun imageTensor(bitmap: Bitmap, targetWidth: Int, targetHeight: Int): FloatArray {
        val output = FloatArray(3 * targetWidth * targetHeight)
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val plane = targetWidth * targetHeight
        for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) {
            val pixel = pixels[y * bitmap.width + x]; val index = y * targetWidth + x
            output[index] = (pixel and 0xff) / 255f
            output[plane + index] = (pixel shr 8 and 0xff) / 255f
            output[plane * 2 + index] = (pixel shr 16 and 0xff) / 255f
        }
        return output
    }

    private fun overlap(a: Rect, b: Rect): Double {
        val width = max(0, min(a.x1, b.x1) - max(a.x0, b.x0)); val height = max(0, min(a.y1, b.y1) - max(a.y0, b.y0))
        val areaA = max(1, (a.x1 - a.x0) * (a.y1 - a.y0)); val areaB = max(1, (b.x1 - b.x0) * (b.y1 - b.y0))
        return width.toDouble() * height / min(areaA, areaB)
    }

    private fun mergePasses(primary: List<Region>, detail: List<Region>): List<Region> {
        val merged = primary.toMutableList()
        for (candidate in detail) {
            val index = merged.indexOfFirst { overlap(it.box, candidate.box) > .55 }
            if (index < 0) merged += candidate
            else {
                val existing = merged[index]
                if ((candidate.source.contains(existing.source) && candidate.source.length > existing.source.length && candidate.confidence >= 50) ||
                    (candidate.source.trimEnd(':', '：') == existing.source.trimEnd(':', '：') && candidate.confidence > existing.confidence)) merged[index] = candidate
            }
        }
        return merged
    }

    override fun close() { det.close(); rec.close(); vrec.close(); options.close() }
}
