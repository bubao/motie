#!/usr/bin/env bash
# =============================================================================
# build-linux-shell.sh — 构建 motie Linux 原生窗口壳（GTK3 + WebKit2GTK）
#
# 产物：<motie 仓库根>/build/motie-shell（与 Go 内核二进制同目录分发，
#       内核按 <exeDir>/motie-shell 查找并拉起，见 desktop_linux.go）。
#
# 依赖（目标机）：
#   - gcc / pkg-config
#   - gtk+-3.0 开发包
#   - webkit2gtk-4.1（优先）或 webkit2gtk-4.0
#   Debian/Ubuntu: sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.1-dev
#   Fedora:        sudo dnf install gcc pkgconf-pkg-config gtk3-devel webkit2gtk4.1-devel
#
# 用法：native_linux/build-linux-shell.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${SHELL_OUT:-${ROOT}/build/motie-shell}"
mkdir -p "$(dirname "${OUT}")"

command -v pkg-config >/dev/null 2>&1 || {
  echo "[ERROR] 未找到 pkg-config" >&2; exit 1; }
pkg-config --exists gtk+-3.0 || {
  echo "[ERROR] 缺少 gtk+-3.0 开发包（libgtk-3-dev / gtk3-devel）" >&2; exit 1; }

WEBKIT_PKG=""
if pkg-config --exists webkit2gtk-4.1; then
  WEBKIT_PKG="webkit2gtk-4.1"
elif pkg-config --exists webkit2gtk-4.0; then
  WEBKIT_PKG="webkit2gtk-4.0"
else
  echo "[ERROR] 缺少 webkit2gtk 开发包（libwebkit2gtk-4.1-dev / webkit2gtk4.1-devel）" >&2
  exit 1
fi

echo "[build-linux-shell] 使用 pkg: gtk+-3.0 ${WEBKIT_PKG}"
gcc -O2 -o "${OUT}" "${ROOT}/native_linux/motie-shell.c" \
  $(pkg-config --cflags --libs gtk+-3.0 "${WEBKIT_PKG}")

[ -s "${OUT}" ] || { echo "[ERROR] 构建产物为空: ${OUT}" >&2; exit 1; }
echo "[OK] Linux 原生壳已生成: ${OUT} ($(du -h "${OUT}" | awk '{print $1}'))"
echo "     提示：将本文件与 motie 内核放在同一目录；内核启动时自动优先拉起它。"
