# accio-skin

给 [Accio Work](https://www.accio.com/work)（Electron 桌面端）换肤的外部工具：**不改安装包**，通过调试协议把一份样式表注入渲染进程，覆盖它的设计 token。

8 套预设 · 强调色 · 壁纸 · 主题包可分享 · 托盘常驻 · 一键还原官方外观。

![星云紫主题](docs/theme-nebula.png)

<sub>星云紫 · 深色。截图由项目内的 `preview.html` 用同一套 token 渲染，内容为示例数据（不含任何真实账号或业务信息）。</sub>

---

## 为什么不是「插件」

Accio 的插件系统（Phoenix，`plugin.json`）只认 Skill / SubAgent / Connector / CLI 四类组件，**没有 UI 或主题扩展点**。
所以这个项目不做成插件，而是一个在外部运行、通过 Chrome DevTools Protocol 给渲染进程注样式的注入器。

## 工作原理

Accio 的配色是**两层 + 混合**的，只改一层会「换一半」：

| 层 | 内容 | 处理方式 |
|---|---|---|
| 第一层 | `:root` 里 49 个颜色 token（`--color-*-value`，另有 5 个非颜色变量），`.dark` 同名覆盖 | 直接重写 |
| 第二层 | Tailwind `@theme` 把 `--color-primary: var(--color-primary-value)` 派生出去；但 `html.dark` 里有 22 条是**硬编码 oklch** | 派生层一并重写 |
| 第三层 | 另有一批表面直接用 Tailwind 调色板类（`bg-zinc-800/60`、`bg-zinc-900`），不读语义 token | 把 `--color-zinc / neutral / slate / gray / stone` 的 50–950 色阶整体映射到当前主题 |

注入的 `<style>` 采用「后追加、同权重」取胜，因此不需要 `!important`，也不会破坏组件自身样式。

```
托盘（可选，PowerShell 常驻）
   └─ node injector.mjs         启动/附着 Accio，CDP 注入，本地控制通道 127.0.0.1:9770
        └─ Accio（带 --remote-debugging-port）
             └─ 页面内：<style> + 悬浮面板（Shadow DOM）
```

## 环境要求

- Windows 10 / 11（托盘与启动脚本是 Windows 专用；核心 `injector.mjs` 是跨平台的）
- **Node.js 22+**（用到 Node 21 起的内置 `WebSocket`）
- Accio Work —— 在 **0.34.4** 上验证通过

> 没装 Node？托盘会弹框让你手动指定 `node.exe`，或直接打开 nodejs.org。选过的路径记在 `.nodepath`（不入库）。

## 快速开始

**推荐：双击 `setup.cmd`**（做两件事，都可撤销）

1. 在「启动」文件夹放一个快捷方式 → 登录 Windows 后托盘静默常驻，平时待命
2. 询问是否给 Accio 的快捷方式追加 `--remote-debugging-port=9222` → 以后点原图标启动即带端口，托盘**直接附着、不重启你的 Accio**

之后：打开 Accio，皮肤自动出现。右下角圆点是控制面板。

### 三种启动方式对比

| 方式 | 命令 | 适合 |
|---|---|---|
| 托盘常驻（推荐） | 双击 `setup.cmd` 一次 | 日常使用，打开即有皮肤 |
| 单次带皮肤启动 | 双击 `start-skin.cmd` | 不想留常驻进程 |
| 手动/自检 | `node injector.mjs` | 调试或接进自己的脚本 |

### 命令行参数

```bash
node injector.mjs                     # 默认皮肤，自动探测并启动 Accio
node injector.mjs --theme=nebula      # 指定默认皮肤
node injector.mjs --attach            # 只挂到已在运行的调试端口，不启动 App
node injector.mjs --list              # 列出 CDP 目标
node injector.mjs --no-panel          # 不注入悬浮面板
node injector.mjs --no-control        # 不启动本地控制通道
node injector.mjs --port=9222         # 调试端口
node injector.mjs --exe="C:\path\Accio.exe"
node injector.mjs --log=%TEMP%\a.log  # 同时写日志文件
```

### 托盘菜单

| 菜单项 | 作用 |
|---|---|
| 显示 / 隐藏皮肤面板 | 等同点右下角圆点 |
| 下一套皮肤 / 选择皮肤 | 切换预设（列表每次展开实时拉取） |
| 还原官方外观 | 关闭皮肤，回到 Accio 原生样式 |
| 打开 Accio（带皮肤） | 若 Accio 未运行则带端口拉起 |
| 自动接管手动打开的 Accio | 默认开。检测到没带端口的 Accio 时，关掉后带端口重启 |
| 重启注入器 / 打开日志 / 退出 | 维护用 |

## 主题包

面板「包」页可以**导出到剪贴板 / 下载 json / 从剪贴板导入**。格式：

```json
{
  "schema": "accio-theme/1",
  "name": "星云紫",
  "theme": "nebula",
  "accent": null,
  "wall": { "type": "none", "value": "", "opacity": 0.62, "blur": 16 },
  "tokens": {
    "light": { "primary": "#6d3fe0", "background": "#fdfbff", "...": "共 49 个" },
    "dark":  { "primary": "#b18cff", "background": "#0b0816", "...": "共 49 个" }
  }
}
```

`wall.type` 可为 `none` / `gradient` / `url`（url 支持 http、本地路径、data URI）。

### 加一套自己的

1. 在 `build-themes.mjs` 的 `PRESETS` 里加一项（只需 10 个锚点色：`bg / layout / container / surface / text / text2 / border / primary / pfg / accent`）
2. `npm run themes` —— 会重新生成 `themes/*.json`，并打印 **WCAG 对比度自检**
3. 重启注入器

预设的 16 组正文对比度目前全部 ≥ 4.5（AA）。

## 截图

| 余烬橙 | 极光青 |
|---|---|
| ![ember](docs/theme-ember.png) | ![aurora](docs/theme-aurora.png) |

| 浅色模式（干净明亮） | 壁纸（渐变 + 半透明表面） |
|---|---|
| ![light](docs/theme-light.png) | ![wallpaper](docs/theme-wallpaper.png) |

控制面板（右下角圆点展开）：

![panel](docs/panel.png)

## 预览页

不想装就先看效果：浏览器直接打开 `preview.html`，8 套预设 × 明暗都能点。它和注入器用的是同一份 token 生成逻辑。

URL 参数（可用于截图或分享某个组合）：

```
preview.html?theme=nebula&mode=dark            # 指定预设与明暗
preview.html?theme=aurora&wall=40              # 叠一层壁纸
preview.html?theme=nebula&mode=dark&panel=1    # 带面板
preview.html?shot=1                            # 纯界面（隐藏挑色台外壳），适合截图
```

`docs/` 里的截图就是 `node tools/shoot-docs.mjs` 用无头 Edge/Chrome 跑这些参数生成的。


## 已知限制

- **标题栏换不了**：Electron 的 `titleBarOverlay` 在主进程，渲染层 CSS 管不到
- **必须带调试端口**：直连打开 Accio 是没有端口的，所以要么从托盘/脚本启动，要么让托盘「接管」（会重启一次 Accio）。会话有持久化，重启一般不丢内容
- **注入器退出后样式保留**：到 Accio 重启为止。想立即还原，用面板/托盘里的「还原官方外观」
- **版本敏感**：Accio 升级可能改动 token 名或色阶用法。若某块颜色没被覆盖，请带上版本号反馈
- **仅样式**：不修改任何业务逻辑、不改安装包、不碰账号态

## 安全与隐私

- 注入内容只有：一个 `<style>`、一个 Shadow DOM 面板、以及 `localStorage` 里的一条主题状态
- 本地控制通道 `127.0.0.1:9770` 只做切皮肤/开关面板/还原，**没有执行命令类接口**，且只绑本机
- 带 `--remote-debugging-port` 意味着本机任意进程都能连 9222 控制该渲染进程 —— 这是调试口的固有性质，别在不受控的机器上长期开着

## 免责声明

非官方项目，与 Accio / 阿里巴巴无关。它不修改安装包，但通过调试协议注入样式，是否适用于你的使用场景请自行判断；升级后失效、或被认为违反服务条款的风险由使用者承担。

## 目录

```
injector.mjs            CDP 注入器（零依赖）
build-themes.mjs        预设定义 + token 生成 + WCAG 自检
themes/*.json           8 套主题包
preview.html            浏览器里预览 8 套（不安装也能看）
tray/accio-skin-tray.ps1 托盘常驻（PowerShell 5.1）
start-tray.vbs          托盘静默启动
start-skin.cmd          单次带皮肤启动
setup.cmd               一键：装自启 + 可选给快捷方式打补丁
install-startup.ps1     装/卸开机自启
patch-shortcuts.ps1     给 Accio 快捷方式加调试参数（留 .bak，可还原）
tools/shoot-docs.mjs    用无头浏览器重新生成 docs/ 截图
docs/                   截图
```

## 卸载

1. `install-startup.ps1 -Remove`（删开机自启）
2. `patch-shortcuts.ps1 -Restore`（还原快捷方式）
3. 托盘菜单「还原官方外观」，然后「退出」

## License

MIT

## 致谢

思路参考 [dsh-dream-skin](https://github.com/RevolutionLA/dsh-dream-skin)（DeepSeek Harness 的换肤插件）—— 那边能走官方 `ctx.theme.register`，这边没有，只能从外部注入。
