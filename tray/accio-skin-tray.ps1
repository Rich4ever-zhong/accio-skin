# Accio Skin 托盘常驻
# 设计：托盘常驻（可开机自启），平时待命；你从任何地方打开 Accio，它检测到就接管并注入皮肤。
# 用法：由仓库根目录的「start-tray.vbs」隐藏启动，或
#       powershell -NoProfile -ExecutionPolicy Bypass -File tray\accio-skin-tray.ps1
param([switch]$SelfTest, [switch]$ResolveNode)

$script:SelfTest = [bool]$SelfTest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $env:TEMP 'accio-skin-tray.log'
$ctl = 'http://127.0.0.1:9770'
$cdp = 'http://127.0.0.1:9222'

function Write-Log([string]$m) {
  try { "$(Get-Date -Format 'MM-dd HH:mm:ss')  $m" | Out-File -FilePath $logPath -Append -Encoding utf8 } catch { }
}

# ---------- 找 Node ----------
function Find-Node {
  if ($env:ACCIO_SKIN_NODE -and (Test-Path $env:ACCIO_SKIN_NODE)) { return $env:ACCIO_SKIN_NODE }

  $cfg = Join-Path $root '.nodepath'
  if (Test-Path $cfg) {
    $p = (Get-Content $cfg -Raw -ErrorAction SilentlyContinue)
    if ($p) { $p = $p.Trim(); if ($p -and (Test-Path $p)) { return $p } }
  }

  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $cands = New-Object System.Collections.ArrayList
  foreach ($base in @("$env:APPDATA\nvm", "$env:APPDATA\fnm\node-versions")) {
    Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | ForEach-Object {
      [void]$cands.Add((Join-Path $_.FullName 'node.exe'))
      [void]$cands.Add((Join-Path $_.FullName 'installation\node.exe'))
    }
  }
  [void]$cands.Add("$env:LOCALAPPDATA\Volta\bin\node.exe")
  [void]$cands.Add("$env:ProgramFiles\nodejs\node.exe")
  [void]$cands.Add("${env:ProgramFiles(x86)}\nodejs\node.exe")
  [void]$cands.Add("$env:LOCALAPPDATA\Programs\nodejs\node.exe")
  [void]$cands.Add("$env:LOCALAPPDATA\Programs\node\node.exe")

  # 某些 IDE / 工具自带的便携 Node（不在 PATH 里）
  foreach ($base in @(
      "$env:USERPROFILE\.workbuddy\binaries\node\versions",
      "$env:LOCALAPPDATA\.workbuddy\binaries\node\versions",
      "$env:LOCALAPPDATA\Programs\Microsoft VS Code\resources\app\resources\node",
      "$env:LOCALAPPDATA\Programs\cursor\resources\app\resources\node"
    )) {
    if (Test-Path $base) {
      Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending |
        ForEach-Object { [void]$cands.Add((Join-Path $_.FullName 'node.exe')) }
    }
  }

  foreach ($p in $cands) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}

function Get-NodeMajor([string]$exe) {
  try { return [int](& $exe -p "process.versions.node.split('.')[0]" 2>$null) } catch { return 0 }
}

function Resolve-Node {
  $n = Find-Node
  if ($n) {
    if ((Get-NodeMajor $n) -lt 21) {
      [System.Windows.Forms.MessageBox]::Show("找到的 Node 版本太旧：`n$n`n`n这个注入器用到 Node 21+ 的内置 WebSocket，请升级到 22 LTS。", 'Accio Skin') | Out-Null
      return $null
    }
    return $n
  }
  if ($ResolveNode) { Write-Output 'node=NOTFOUND'; return $null }

  $msg = "没找到 Node.js（需要 22 或更高版本）。`n`n点「是」：手动选择已有的 node.exe`n点「否」：打开 nodejs.org 下载安装（推荐 LTS）`n`n选中的路径会记在 .nodepath，下次不用再选。"
  $r = [System.Windows.Forms.MessageBox]::Show($msg, 'Accio Skin', 'YesNoCancel', 'Question')
  if ($r -eq 'Yes') {
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Filter = 'node.exe|node.exe'
    $dlg.Title = '选择 node.exe（Node 22 或更高）'
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      try { Set-Content -Path (Join-Path $root '.nodepath') -Value $dlg.FileName -Encoding ASCII } catch { }
      return $dlg.FileName
    }
  } elseif ($r -eq 'No') {
    Start-Process 'https://nodejs.org'
  }
  return $null
}

$node = Resolve-Node
if (-not $node) { exit 1 }

if ($ResolveNode) {
  Write-Output "node=$node"
  Write-Output "major=$(Get-NodeMajor $node)"
  exit 0
}

Write-Log "tray start · node=$node · root=$root"

# ---------- 托盘图标（运行时画，不依赖图片资源） ----------
function New-TrayIcon {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $ring = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(53, 224, 176))
  $g.FillEllipse($ring, 1, 1, 30, 30)
  $core = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(6, 17, 15))
  $g.FillEllipse($core, 11, 11, 10, 10)
  $g.Dispose(); $ring.Dispose(); $core.Dispose()
  return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

# ---------- 进程与端口 ----------
$script:proc = $null
$script:procAt = [DateTime]::MinValue
$script:stopping = $false
$script:blocked = $false
$script:hint = ''
$script:autoTakeover = $true
$script:lastTakeover = [DateTime]::MinValue
$script:exitHints = @{
  2 = '连不上调试端口'
  3 = 'Accio 已在运行但没开调试端口'
  4 = '找不到 Accio 安装路径'
  5 = '启动 Accio 后等不到调试端口'
  6 = '没找到 Accio 窗口'
}

function Start-Injector {
  if ($script:stopping) { return }
  if ($script:proc -and -not $script:proc.HasExited) { return }
  # 不用 -RedirectStandardOutput：WinPS 5.1 在环境同时存在 http_proxy/HTTP_PROXY 时会抛「字典已添加关键字」
  $injLog = Join-Path $env:TEMP 'accio-skin-injector.log'
  try {
    $script:proc = Start-Process -FilePath $node -ArgumentList @('injector.mjs', "--log=$injLog") `
      -WorkingDirectory $root -WindowStyle Hidden -PassThru
    $script:procAt = Get-Date
    Write-Log "injector started pid=$($script:proc.Id)"
  } catch {
    Write-Log "injector start failed: $_"
  }
}

function Stop-Injector {
  if ($script:proc -and -not $script:proc.HasExited) {
    try { Stop-Process -Id $script:proc.Id -Force -ErrorAction SilentlyContinue } catch { }
    Write-Log 'injector stopped'
  }
  $script:proc = $null
}

function Get-SkinStatus {
  try { return Invoke-RestMethod -Uri "$ctl/status" -TimeoutSec 2 } catch { return $null }
}
function Test-CdpPort {
  try {
    $r = Invoke-WebRequest -Uri "$cdp/json/version" -TimeoutSec 1 -UseBasicParsing
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}
function Test-AccioRunning {
  return [bool](Get-Process Accio -ErrorAction SilentlyContinue)
}

# 接管：把「用户手动打开、没带调试端口」的 Accio 关掉，再由注入器带端口拉起
function Invoke-Takeover([string]$why) {
  Write-Log "takeover ($why)"
  Get-Process Accio -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
  Stop-Injector
  $script:blocked = $false
  $script:lastTakeover = Get-Date
  Start-Injector
}

# ---------- 托盘界面 ----------
$icon = New-TrayIcon
$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = $icon
$ni.Text = 'Accio Skin'
$ni.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miStatus = New-Object System.Windows.Forms.ToolStripMenuItem '状态：待命'
$miStatus.Enabled = $false
[void]$menu.Items.Add($miStatus)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$miPanel = New-Object System.Windows.Forms.ToolStripMenuItem '显示 / 隐藏皮肤面板'
$miPanel.Add_Click({ try { Invoke-RestMethod -Uri "$ctl/panel" -TimeoutSec 2 | Out-Null } catch { } })
[void]$menu.Items.Add($miPanel)

$miNext = New-Object System.Windows.Forms.ToolStripMenuItem '下一套皮肤'
$miNext.Add_Click({
    try { $r = Invoke-RestMethod -Uri "$ctl/next" -TimeoutSec 3; if ($r.ok) { $ni.Text = "Accio Skin · $($r.name)" } } catch { Write-Log 'next failed' }
  })
[void]$menu.Items.Add($miNext)

$sub = New-Object System.Windows.Forms.ToolStripMenuItem '选择皮肤'
$sub.Add_DropDownOpening({
    $this.DropDownItems.Clear()
    $s = Get-SkinStatus
    if ($s -and $s.themes) {
      foreach ($t in $s.themes) {
        $item = New-Object System.Windows.Forms.ToolStripMenuItem $t.name
        $item.Tag = $t.id
        $item.Add_Click({
            $id = $this.Tag
            try { Invoke-RestMethod -Uri "$ctl/theme?id=$id" -TimeoutSec 3 | Out-Null } catch { }
          })
        [void]$this.DropDownItems.Add($item)
      }
    } else {
      $n = New-Object System.Windows.Forms.ToolStripMenuItem '（未连接）'
      $n.Enabled = $false
      [void]$this.DropDownItems.Add($n)
    }
  })
[void]$menu.Items.Add($sub)

$miOff = New-Object System.Windows.Forms.ToolStripMenuItem '还原官方外观'
$miOff.Add_Click({ try { Invoke-RestMethod -Uri "$ctl/off" -TimeoutSec 3 | Out-Null } catch { } })
[void]$menu.Items.Add($miOff)

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$miLaunch = New-Object System.Windows.Forms.ToolStripMenuItem '打开 Accio（带皮肤）'
$miLaunch.Add_Click({
    $script:blocked = $false
    if (Test-AccioRunning) { Invoke-Takeover 'manual launch menu' } else { Stop-Injector; Start-Injector }
  })
[void]$menu.Items.Add($miLaunch)

$miAuto = New-Object System.Windows.Forms.ToolStripMenuItem '自动接管手动打开的 Accio'
$miAuto.CheckOnClick = $true
$miAuto.Checked = $script:autoTakeover
$miAuto.Add_Click({ $script:autoTakeover = $this.Checked; Write-Log "autoTakeover=$($script:autoTakeover)" })
[void]$menu.Items.Add($miAuto)

$miRestart = New-Object System.Windows.Forms.ToolStripMenuItem '重启注入器'
$miRestart.Add_Click({ $script:blocked = $false; Stop-Injector; Start-Sleep -Milliseconds 400; Start-Injector })
[void]$menu.Items.Add($miRestart)

$miLog = New-Object System.Windows.Forms.ToolStripMenuItem '打开日志'
$miLog.Add_Click({
    $p = Join-Path $env:TEMP 'accio-skin-injector.log'
    if (Test-Path $p) { Start-Process notepad.exe $p } else { Start-Process notepad.exe $logPath }
  })
[void]$menu.Items.Add($miLog)

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$miExit = New-Object System.Windows.Forms.ToolStripMenuItem '退出（保留当前皮肤）'
$miExit.Add_Click({
    $script:stopping = $true
    Stop-Injector
    $ni.Visible = $false
    $ni.Dispose()
    [System.Windows.Forms.Application]::Exit()
  })
[void]$menu.Items.Add($miExit)

$ni.ContextMenuStrip = $menu
$ni.Add_MouseDoubleClick({ try { Invoke-RestMethod -Uri "$ctl/panel" -TimeoutSec 2 | Out-Null } catch { } })

# ---------- 调度：待命 → 检测 Accio → 接管/附着 ----------
$script:ticks = 0
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2500
$timer.Add_Tick({
    $script:ticks++
    $now = Get-Date

    # 1) 注入器退出了？
    if ($script:proc -and $script:proc.HasExited) {
      $code = $script:proc.ExitCode
      Write-Log "injector exited code=$code"
      $script:proc = $null
      if ($script:exitHints.ContainsKey($code)) {
        $script:blocked = $true
        $script:hint = $script:exitHints[$code]
        Write-Log "blocked: $($script:hint)"
      }
    }

    $accio = Test-AccioRunning
    $status = Get-SkinStatus
    $injAlive = [bool]($script:proc -and -not $script:proc.HasExited)
    $injYoung = $injAlive -and ((($now - $script:procAt).TotalSeconds) -lt 30)

    # 2) Accio 没开 → 刚拉起的注入器可能正在启动它，别急着收
    if (-not $accio) {
      if ($injYoung) {
        $miStatus.Text = '状态：正在启动 Accio…'
        $ni.Text = 'Accio Skin · 启动中'
        if ($script:SelfTest) { Write-Log "selftest tick=$($script:ticks) accio=false launching" }
        return
      }
      if ($script:blocked) { $script:blocked = $false }
      if ($script:proc) { Stop-Injector }
      $miStatus.Text = '状态：待命（等你打开 Accio）'
      $ni.Text = 'Accio Skin · 待命'
      if ($script:SelfTest) { Write-Log "selftest tick=$($script:ticks) accio=false" }
      return
    }

    # 3) 已连上
    if ($status -and $status.ok) {
      $miStatus.Text = "皮肤：$($status.name) · 已连接"
      $ni.Text = "Accio Skin · $($status.name)"
      if ($script:SelfTest) { Write-Log "selftest tick=$($script:ticks) accio=true connected=true" }
      return
    }

    # 4) Accio 已经带调试端口启动（快捷方式里加了参数）→ 直接附着，不必杀进程
    if (Test-CdpPort) {
      if (-not $script:proc -or (($now - $script:procAt).TotalSeconds -gt 20)) {
        Write-Log 'accio has cdp port, (re)starting injector to attach'
        Stop-Injector
        Start-Injector
      }
      $miStatus.Text = '状态：正在附着 Accio…'
      $ni.Text = 'Accio Skin · 附着中'
      if ($script:SelfTest) { Write-Log "selftest tick=$($script:ticks) accio=true cdp=true attaching" }
      return
    }

    # 5) Accio 开着但没连上、也没端口 → 自动接管
    #    必须等够时间再判断：注入器要 4~10 秒才能把 Accio 拉起来并注入，
    #    这期间「进程在、端口没开、状态没连上」是正常中间态，不能当成「用户手动打开的」处理。
    $accOldEnough = $true
    try {
      $first = Get-Process Accio -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -First 1
      if ($first) { $accOldEnough = ((($now - $first.StartTime).TotalSeconds) -gt 20) }
    } catch { }

    if ($script:autoTakeover -and -not $injYoung -and $accOldEnough -and (($now - $script:lastTakeover).TotalSeconds -gt 15)) {
      Invoke-Takeover 'accio running without skin'
      $miStatus.Text = '状态：正在接管 Accio…'
      $ni.Text = 'Accio Skin · 接管中'
      if ($script:SelfTest) { Write-Log "selftest tick=$($script:ticks) accio=true takeover" }
      return
    }

    if ($script:blocked) { $miStatus.Text = "需要处理：$($script:hint)" }
    elseif ($script:autoTakeover) { $miStatus.Text = '状态：检测到 Accio，准备接管…' }
    else { $miStatus.Text = '状态：Accio 未带皮肤（菜单可接管）' }
    if ($script:SelfTest) { Write-Log "selftest tick=$($script:ticks) accio=true waiting blocked=$($script:blocked) proc=$([bool]$script:proc)" }
  })

# 自检模式主动起一次，方便无人值守验证
if ($script:SelfTest) { Start-Injector }
$timer.Start()

if ($script:SelfTest) {
  $guard = New-Object System.Windows.Forms.Timer
  $guard.Interval = 40000
  $guard.Add_Tick({ Write-Log 'selftest guard timeout'; [System.Windows.Forms.Application]::Exit() })
  $guard.Start()
}

[System.Windows.Forms.Application]::Run()

$timer.Stop()
if ($script:SelfTest) {
  Write-Log 'selftest finished'
  Stop-Injector
}
