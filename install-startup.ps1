# 开机自启 / 取消自启：把托盘放进当前用户的「启动」文件夹
# 安装：powershell -NoProfile -ExecutionPolicy Bypass -File install-startup.ps1
# 取消：powershell -NoProfile -ExecutionPolicy Bypass -File install-startup.ps1 -Remove
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Accio Skin.lnk'

if ($Remove) {
  if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Output "已移除开机自启：$lnk" }
  else { Write-Output '本来就没有装过开机自启。' }
  exit 0
}

if (-not (Test-Path (Join-Path $root 'start-tray.vbs'))) {
  Write-Output '找不到 start-tray.vbs，请在 accio-skin 目录里运行本脚本。'
  exit 1
}

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$sc.Arguments = '"' + (Join-Path $root 'start-tray.vbs') + '"'
$sc.WorkingDirectory = $root
$sc.Description = 'Accio Skin tray (silent)'
$sc.Save()

Write-Output "已安装开机自启：$lnk"
Write-Output '下次登录 Windows 时托盘会自动起来（无窗口），然后等你打开 Accio。'
