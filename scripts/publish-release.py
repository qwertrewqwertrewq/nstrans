import os
import sys
import time
import subprocess
import requests

def get_github_token():
    os.environ['PATH'] = r'C:\Program Files\Git\cmd;C:\Program Files\Git\mingw64\bin;' + os.environ.get('PATH', '')
    res = subprocess.run(
        ['git-credential-manager', 'get'],
        input='protocol=https\nhost=github.com\n',
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    for line in res.stdout.splitlines():
        if line.startswith('password='):
            return line.split('=', 1)[1].strip()
    raise RuntimeError("Could not retrieve GitHub token from git credential manager")

class ProgressFileReader:
    def __init__(self, filepath, chunk_size=1024 * 1024):
        self.filepath = filepath
        self.total_size = os.path.getsize(filepath)
        self.file = open(filepath, 'rb')
        self.bytes_read = 0
        self.start_time = time.time()
        self.last_report = time.time()
        self.last_bytes = 0
        self.chunk_size = chunk_size

    def __iter__(self):
        return self

    def __next__(self):
        chunk = self.file.read(self.chunk_size)
        if not chunk:
            self.file.close()
            raise StopIteration
        self.bytes_read += len(chunk)
        now = time.time()
        if now - self.last_report >= 3.0 or self.bytes_read == self.total_size:
            pct = (self.bytes_read / self.total_size) * 100.0
            mb_read = self.bytes_read / (1024 * 1024)
            mb_total = self.total_size / (1024 * 1024)
            speed = ((self.bytes_read - self.last_bytes) / (1024 * 1024)) / max(0.1, (now - self.last_report))
            elapsed = now - self.start_time
            print(f"[{elapsed:6.1f}s] Uploading: {mb_read:6.1f} / {mb_total:6.1f} MB ({pct:5.1f}%) @ {speed:5.2f} MB/s", flush=True)
            self.last_report = now
            self.last_bytes = self.bytes_read
        return chunk

    def read(self, size=-1):
        if size == -1 or size is None:
            chunk = self.file.read()
        else:
            chunk = self.file.read(size)
        if not chunk:
            return b''
        self.bytes_read += len(chunk)
        now = time.time()
        if now - self.last_report >= 3.0 or self.bytes_read == self.total_size:
            pct = (self.bytes_read / self.total_size) * 100.0
            mb_read = self.bytes_read / (1024 * 1024)
            mb_total = self.total_size / (1024 * 1024)
            speed = ((self.bytes_read - self.last_bytes) / (1024 * 1024)) / max(0.1, (now - self.last_report))
            elapsed = now - self.start_time
            print(f"[{elapsed:6.1f}s] Uploading: {mb_read:6.1f} / {mb_total:6.1f} MB ({pct:5.1f}%) @ {speed:5.2f} MB/s", flush=True)
            self.last_report = now
            self.last_bytes = self.bytes_read
        return chunk

    def __len__(self):
        return self.total_size

    def close(self):
        if not self.file.closed:
            self.file.close()

def main():
    repo = "qwertrewqwertrewq/nstrans"
    tag = "v0.1.0"
    title = "NSTrans v0.1.0 (Windows)"
    body = (
        "## NSTrans v0.1.0 - Windows Release\n\n"
        "实时日文 OCR 与翻译覆盖桌面客户端（Windows x64 版本）。\n\n"
        "### 特性亮点\n"
        "- **离线 MeikiOCR**：内置 Windows 独立 OCR 离线推理运行时，高精度识别日文及日英混合游戏文字。\n"
        "- **视频与采集卡支持**：支持 USB 采集卡输入与摄像头实时画面捕获、全屏及展开视图。\n"
        "- **智能覆盖显示**：在视频流上高亮定位并覆盖翻译结果。\n"
        "- **离线/在线模型**：支持本地 TranslateGemma / LLM 翻译后端切换。\n\n"
        "### 校验信息 (Checksum)\n"
        "- **SHA256 (`NSTrans_0.1.0_x64-setup.exe`)**:\n"
        "  `545B02C8D64CEB61ACBFF45B856275A262A17BCD97B7026CEDDD03C27CB5EC88`\n"
    )

    token = get_github_token()
    print("Retrieved token for user authentication.")

    headers = {
        'Authorization': f'token {token}',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'NSTrans-Release-Uploader'
    }

    # 1. Get or create release
    print(f"Checking existing release for tag {tag} in {repo}...")
    rel_res = requests.get(f"https://api.github.com/repos/{repo}/releases/tags/{tag}", headers=headers)
    release = None
    if rel_res.status_code == 200:
        release = rel_res.json()
        print(f"Found existing release ID {release['id']}")
    else:
        print(f"Release for {tag} does not exist. Creating release...")
        create_payload = {
            "tag_name": tag,
            "target_commitish": "main",
            "name": title,
            "body": body,
            "draft": True,
            "prerelease": False
        }
        create_res = requests.post(f"https://api.github.com/repos/{repo}/releases", json=create_payload, headers=headers)
        if create_res.status_code not in (200, 201):
            print(f"Failed to create release: {create_res.status_code} {create_res.text}")
            sys.exit(1)
        release = create_res.json()
        print(f"Created draft release ID {release['id']}")

    release_id = release['id']
    upload_url_template = release['upload_url'] # format: https://uploads.github.com/repos/.../assets{?name,label}
    base_upload_url = upload_url_template.split('{')[0]

    installer_path = r"src-tauri\target\release\bundle\nsis\NSTrans_0.1.0_x64-setup.exe"
    if not os.path.exists(installer_path):
        print(f"Error: {installer_path} not found!")
        sys.exit(1)

    file_size = os.path.getsize(installer_path)
    file_name = os.path.basename(installer_path)
    print(f"Target file: {file_name} ({file_size / (1024*1024):.2f} MB)")

    # 2. Check if asset already exists
    existing_assets = release.get('assets', [])
    for asset in existing_assets:
        if asset['name'] == file_name:
            print(f"Asset {file_name} already exists (ID: {asset['id']}), deleting it first...")
            del_res = requests.delete(f"https://api.github.com/repos/{repo}/releases/assets/{asset['id']}", headers=headers)
            print("Deleted old asset status:", del_res.status_code)

    # 3. Upload asset
    print(f"Uploading {file_name} to GitHub release...")
    upload_url = f"{base_upload_url}?name={file_name}"
    reader = ProgressFileReader(installer_path)

    upload_headers = {
        'Authorization': f'token {token}',
        'Content-Type': 'application/octet-stream',
        'Content-Length': str(file_size),
        'User-Agent': 'NSTrans-Release-Uploader'
    }

    try:
        up_res = requests.post(
            upload_url,
            headers=upload_headers,
            data=reader,
            timeout=1800
        )
        print(f"Upload response status: {up_res.status_code}")
        if up_res.status_code not in (200, 201):
            print("Upload response body:", up_res.text)
            sys.exit(1)
        print("Upload successful!")
    finally:
        reader.close()

    # 4. Also upload sha256 checksum file
    sha256_path = installer_path + ".sha256"
    with open(sha256_path, 'w', encoding='utf-8') as f:
        f.write("545B02C8D64CEB61ACBFF45B856275A262A17BCD97B7026CEDDD03C27CB5EC88  NSTrans_0.1.0_x64-setup.exe\n")
    sha_size = os.path.getsize(sha256_path)
    sha_name = os.path.basename(sha256_path)

    print(f"Uploading checksum {sha_name}...")
    with open(sha256_path, 'rb') as f:
        sha_headers = {
            'Authorization': f'token {token}',
            'Content-Type': 'text/plain',
            'Content-Length': str(sha_size),
            'User-Agent': 'NSTrans-Release-Uploader'
        }
        requests.post(f"{base_upload_url}?name={sha_name}", headers=sha_headers, data=f)
    print("Uploaded checksum.")

    # 5. Publish release (set draft to False)
    print("Publishing release...")
    patch_res = requests.patch(
        f"https://api.github.com/repos/{repo}/releases/{release_id}",
        headers=headers,
        json={"draft": False}
    )
    if patch_res.status_code == 200:
        pub_release = patch_res.json()
        print(f"Release published successfully: {pub_release.get('html_url')}")
    else:
        print(f"Failed to set draft=False: {patch_res.status_code} {patch_res.text}")

if __name__ == '__main__':
    main()
