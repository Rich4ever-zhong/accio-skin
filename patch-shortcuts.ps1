# 给 Accio 的快捷方式加上调试端口参数
# 作用：这样你（或系统）用原快捷方式打开 Accio 时，它一启动就带调试端口，
#       托盘可以直接附着注入，不需要「关掉再重启」。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File patch-shortcuts.ps1
# 还原：powershell -NoProfile -ExecutionPolicy Bypass -File patch-shortcuts.ps1 -Restore
param([switch]$Restore)

$ErrorActionPreference = 'Continue'
$flag = '--remote-debugging-port=9222'

$dirs = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) '..'),
  [Environment]::GetFolderPath('CommonPrograms'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

$ws = New-Object -ComObject WScript.Shell
$found = 0
$patched = 0
$restored = 0

foreach ($dir in $dirs) {
  $lnks = Get-ChildItem -Path $dir -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue
  foreach ($f in $lnks) {
    $text = $f.FullName
    if ($text -like '*Accio*') { }  # 名字里带 Accio 的先看；不带名字的下面靠目标路径判断
    try {
      $sc = $ws.CreateShortcut($f.FullName)
      $target = $sc.TargetPath
    } catch { continue }
    if (-not $target -or ($target -notmatch 'Accio\.exe$')) { continue }
    $found++

    if ($Restore) {
      $bak = $f.FullName + '.bak'
      if (Test-Path $bak) {
        Copy-Item $bak $f.FullName -Force
        Remove-Item $bak -Force
        $restored++
        Write-Output "还原：$($f.FullName)"
      }
      continue
    }

    if ($sc.Arguments -like "*$flag*") {
      Write-Output "已是带皮肤的快捷方式：$($f.FullName)"
      continue
    }

    $bak = $f.FullName + '.bak'
    if (-not (Test-Path $bak)) { Copy-Item $f.FullName $bak -Force }
    $sc.Arguments = (($sc.Arguments + ' ' + $flag).Trim())
    $sc.Save()
    $patched++
    Write-Output "已加参数：$($f.FullName)"
  }
}

if ($Restore) { Write-Output "`n共还原 $restored 个（找到 $found 个指向 Accio 的快捷方式）" }
else { Write-Output "`n共修改 $patched 个（找到 $found 个指向 Accio 的快捷方式）" }
Write-Output '修改前都留了 .bak，可用 -Restore 一键还原。'
