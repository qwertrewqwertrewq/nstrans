# NSTrans TV 客户端

面向 Android 6 及以上电视、投影仪的 HDMI 悬浮字幕接收端。应用通过厂商提供的 TV Input Framework 显示 HDMI；切换到厂商自带 HDMI 应用后，后台 `OverlayService` 仍会在最上层显示 NSTrans 发来的翻译。

## 局域网工作方式

- 电视端每 2 秒向 UDP `38472` 广播一次 `nstrans-tv-v1` 设备信息。
- macOS、Windows 或现有 NSTrans 客户端会自动列出同一局域网的电视，也可以直接填写电视 IP。
- NSTrans 连接 TCP `38471` 完成握手；电视端为当前控制器生成临时会话令牌。
- 文本模式传输字幕、原始画布尺寸、坐标、字体、透明度和滚动时长，由电视实时绘制。
- 图片模式传输透明 PNG 字幕图层；NSTrans 在连接期间隐藏本机字幕层，电视端按屏幕尺寸缩放合成。
- 断开连接时会立即清空电视字幕。协议只在局域网中工作，不上传 OCR 原文或画面。

## 构建和安装

```bash
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell appops set com.example.androidscreenclient SYSTEM_ALERT_WINDOW allow
adb shell am start -n com.example.androidscreenclient/.MainActivity
adb logcat -s NSTransTvClient HdmiOverlayTest
```

APK 路径：`app/build/outputs/apk/debug/app-debug.apk`。

电视与运行 NSTrans 的设备必须位于允许 UDP 广播和局域网设备互访的同一个网络。访客 Wi-Fi、AP 隔离或系统防火墙可能阻止自动发现，此时可在 NSTrans 中手动填写电视 IP；TCP `38471` 仍需可访问。

## HDMI 限制

Android 没有面向所有设备的通用 HDMI 输入 API。本客户端依赖厂商把 HDMI 注册到 TV Input Framework。若没有注册，可以进入厂商自带 HDMI 应用；只要已经授予悬浮窗权限，NSTrans 字幕服务仍可覆盖在其上层。

检查输入：

```bash
adb shell dumpsys tv_input
adb shell pm list packages -s | grep -Ei 'hdmi|tv|source|input'
```

停止接收服务：

```bash
adb shell am stopservice -n com.example.androidscreenclient/.OverlayService
```
