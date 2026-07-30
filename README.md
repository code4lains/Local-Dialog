# Local Dialog (Web & Desktop)

基于 WebRTC 的点对点局域网大文件传输助手。
本项目支持作为网页应用（静态部署到 Cloudflare Pages 或其他 CDN）运行，也支持通过 Tauri 构建为原生桌面端应用（Windows, macOS, Linux）。

## 特性
- ⚡ 基于 WebRTC 和 PeerJS，P2P 端到端直连，无需中间服务器中转。
- 📱 响应式 UI，完美支持移动端网页访问与桌面端原生运行。
- 🔍 基于 IP Hash 的自动局域网发现机制。
- 🔗 支持二维码扫码，快速建立专属传输房间。
- 📦 **大文件切片传输**防内存溢出，自带实时进度条与本地自动生成下载链接功能。
- 🌙 现代化暗色主题设计 (Material-UI)。

---

## 快速开始 (本地开发)

### 1. 准备环境
请确保你的电脑上安装了：
- **Node.js** (推荐 LTS 版本)
- **Rust** (用于编译 Tauri 桌面端，[安装指南](https://tauri.app/v1/guides/getting-started/prerequisites))

### 2. 安装依赖
```bash
npm install
```

### 3. 运行项目
项目支持双端开发调试：

**方案 A：运行 Web 端开发服务（适合调试网页版 UI）**
```bash
npm run dev
```
启动后可在浏览器中打开 `http://localhost:5173`。

**方案 B：运行桌面端开发服务（会弹出 Tauri 原生窗口）**
```bash
npm run tauri dev
```

---

## 构建与部署

### 🌐 部署网页版到 Cloudflare Pages
Vite 构建输出纯静态文件，非常适合部署在 Cloudflare Pages。
1. 将本项目推送至你的 GitHub 仓库。
2. 登录 Cloudflare 控制台，选择 **Pages -> 连接到 Git**。
3. 选择你的项目仓库，并在构建设置中填写：
   - **框架预设**：选择 `Vite` (或 None)
   - **构建命令**：`npm run build`
   - **构建输出目录**：`dist`
4. 点击“保存并部署”，完成后你将获得一个公共访问链接。手机浏览器访问该链接即可使用。

### 💻 打包桌面端 (Tauri)
如果你想要将项目打包为独立的 Windows `.exe` 或 macOS `.app`：
```bash
npm run tauri build
```
*(注意：首次构建 Tauri 需要下载大量的 Rust 依赖编译，可能需要较长时间。打包完成后的产物通常位于 `src-tauri/target/release/bundle` 目录下。)*

---

## 注意事项与 API 兼容性
- 本项目未包含任何仅限 Node.js 环境执行的特定包，所有核心逻辑（如 `crypto.subtle` 哈希计算、FileReader 等）均基于纯浏览器 API 编写，因此它完全符合静态网页的前端打包要求。
- 移动端体验已经过优化，已添加了防止缩放的 `viewport` 和 `100dvh` CSS 属性，防止手机原生键盘弹起遮挡输入框。
