# NSTrans TV 客户端

面向 Android 6 及以上电视、投影仪的 HDMI 字幕接收端。默认仅在 NSTrans TV 应用内显示字幕，不需要悬浮窗权限；用户可在应用右下角主动选择“尝试启用 App 外字幕”，完成系统授权后，切换到厂商自带 HDMI 应用也能继续显示字幕。授权失败或关闭 App 外模式时会自动回到 App 内字幕。

## 局域网工作方式

- 电视端每 2 秒向 UDP `38472` 广播一次 `nstrans-tv-v1` 设备信息。
- macOS、Windows 或现有 NSTrans 客户端会自动列出同一局域网的电视，也可以直接填写电视 IP。
- NSTrans 连接 TCP `38471` 完成握手；电视端为当前控制器生成临时会话令牌。
- 文本模式传输字幕、原始画布尺寸、坐标、字体、透明度和滚动时长，由电视实时绘制。
- 图片模式传输透明 PNG 字幕图层；NSTrans 在连接期间隐藏本机字幕层，电视端按屏幕尺寸缩放合成。
- 默认模式为仅 App 内字幕；悬浮窗权限不会在启动时自动申请，必须由用户在界面主动启用。已授权后也可随时切回仅 App 内模式，无需撤销系统权限。
- 在应用内观看系统 HDMI 输入时主动取得媒体音频焦点，并将遥控器音量键绑定到系统媒体音量；切换到其他 HDMI 应用时释放音频焦点。
- 断开连接时会立即清空电视字幕。协议只在局域网中工作，不上传 OCR 原文或画面。

## 构建和安装

```bash
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.example.androidscreenclient/.MainActivity
adb logcat -s NSTransTvClient HdmiOverlayTest
```

安装后无需通过 ADB 授予悬浮窗权限。字幕默认仅在应用内显示；如需覆盖厂商 HDMI 或其他应用，请在 NSTrans TV 右下角选择“尝试启用 App 外字幕”，再按系统提示授权。

APK 路径：`app/build/outputs/apk/debug/app-debug.apk`。

电视与运行 NSTrans 的设备必须位于允许 UDP 广播和局域网设备互访的同一个网络。访客 Wi-Fi、AP 隔离或系统防火墙可能阻止自动发现，此时可在 NSTrans 中手动填写电视 IP；TCP `38471` 仍需可访问。

## HDMI 限制

Android 没有面向所有设备的通用 HDMI 输入 API。本客户端依赖厂商把 HDMI 注册到 TV Input Framework。若没有注册，可以进入厂商自带 HDMI 应用；只要已经授予悬浮窗权限，NSTrans 字幕服务仍可覆盖在其上层。

应用不申请麦克风权限，也不会录制 HDMI 声音。HDMI 音频由厂商 TV Input Session 直接路由到系统媒体输出；如果画面正常但仍无声，请确认电视媒体音量未静音，并通过 `adb logcat -s HdmiOverlayTest` 检查 `HDMI audio focus request` 是否成功。

检查输入：

```bash
adb shell dumpsys tv_input
adb shell pm list packages -s | grep -Ei 'hdmi|tv|source|input'
```

停止接收服务：

```bash
adb shell am stopservice -n com.example.androidscreenclient/.OverlayService
```
