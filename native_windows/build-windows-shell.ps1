# =============================================================================
# build-windows-shell.ps1 — 构建 motie Windows 原生窗口壳（WinForms + WebView2）
#
# 产物：<motie 仓库根>/build/motie-shell.exe（与 Go 内核二进制同目录分发，
#       内核按 <exeDir>/motie-shell.exe 查找并拉起，见 desktop_windows.go）。
#
# 依赖（目标机）：
#   - .NET 8 SDK（dotnet --info 可查；构建需联网还原 Microsoft.Web.WebView2 包）
#   - 运行期：WebView2 Runtime（Win10/11 通常已内置；或Evergreen 引导程序）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File native_windows\build-windows-shell.ps1
#   powershell -ExecutionPolicy Bypass -File native_windows\build-windows-shell.ps1 -SelfContained
#
# 说明：默认 framework-dependent（体积小，需目标机已装 .NET 8 Desktop Runtime）；
#       -SelfContained 产出独立包（体积大，无需运行时）。两者均为单文件 exe。
# =============================================================================
param(
    [switch]$SelfContained,
    [ValidateSet("win-x64", "win-arm64")]
    [string]$Runtime = "win-x64",
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
$Project = Join-Path $PSScriptRoot "motie-shell.csproj"
$Out = if ($OutDir) { $OutDir } else { Join-Path $Root "build" }
$TempPublish = Join-Path ([System.IO.Path]::GetTempPath()) ("motie-shell-publish-" + [guid]::NewGuid().ToString("N"))

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    Write-Error "未找到 dotnet CLI：请安装 .NET 8 SDK（https://dotnet.microsoft.com/download）"
}
if (-not (Test-Path $Project)) {
    Write-Error "缺少项目文件: $Project"
}

New-Item -ItemType Directory -Force -Path $Out | Out-Null

$selfContained = if ($SelfContained) { "true" } else { "false" }
Write-Host "[build-windows-shell] dotnet publish -r $Runtime (self-contained=$selfContained)"

& dotnet publish $Project `
    -c Release `
    -r $Runtime `
    --self-contained $selfContained `
    -p:PublishSingleFile=true `
    -p:PublishDir=$TempPublish `
    -o $TempPublish

$exe = Join-Path $TempPublish "motie-shell.exe"
if (-not (Test-Path $exe)) {
    Write-Error "publish 未产出 motie-shell.exe：$exe"
}

$target = Join-Path $Out "motie-shell.exe"
Copy-Item $exe $target -Force
Remove-Item $TempPublish -Recurse -Force -ErrorAction SilentlyContinue

$size = (Get-Item $target).Length / 1MB
Write-Host "[OK] Windows 原生壳已生成: $target ($('{0:N1}' -f $size) MB)"
Write-Host "     提示：将本文件与 motie.exe 放在同一目录；内核启动时自动优先拉起它。"
