# NSTrans 测试工具

此目录只包含开发与诊断工具，不参与客户端发行构建。

- `start-virtualcam.bat`：从项目根目录启动 Windows 虚拟摄像头测试。
- `start-virtualcam-test.py`：生成带日文 UI 和对话的合成测试画面，不读取或分发游戏素材。
- `test-cam.html`：交互式摄像头授权、枚举与预览页面。
- `test-enum.html`：将媒体设备枚举结果发送到本机 `127.0.0.1:9999`。
- `test-perm.html`：请求摄像头权限后，将枚举结果发送到本机 `127.0.0.1:9999`。

运行虚拟摄像头前，需要在 `.build/windows/venv` 中安装脚本使用的 OpenCV、Pillow、NumPy 和 `pyvirtualcam`，并安装可接收虚拟摄像头输出的驱动或应用。

本地测试录像可以放在此目录，但视频扩展名已被项目 `.gitignore` 排除，不应提交到仓库或打包进 Release。
