#!/usr/bin/env bash
# =============================================================================
# macos-dmg.sh — 生成 macOS 拖拽安装 .dmg
#
# 流程：临时暂存目录放入 .app 与 /Applications 符号链接 → UDRW 原始镜像
#       → UDZO（zlib 压缩，只读）最终镜像。仅在 macOS 上可用。
#
# 参数：
#   $1 - .app 路径
#   $2 - 输出 .dmg 路径
#   $3 - 卷标名（默认 Motie）
# =============================================================================
set -euo pipefail

APP_PATH="$1"
DMG_PATH="$2"
VOLUME_NAME="${3:-Motie}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[ERROR] DMG 生成仅在 macOS 上可用" >&2
  exit 1
fi
[[ -d "${APP_PATH}" ]] || { echo "[ERROR] 未找到 .app: ${APP_PATH}" >&2; exit 1; }

APP_PATH="$(cd "$(dirname "$APP_PATH")" && pwd)/$(basename "$APP_PATH")"
mkdir -p "$(dirname "${DMG_PATH}")"
DMG_PATH="$(cd "$(dirname "${DMG_PATH}")" && pwd)/$(basename "${DMG_PATH}")"

STAGING="$(mktemp -d)"
RW_DMG="$(mktemp -u "${TMPDIR:-/tmp}/motie-rw-XXXXXX.dmg")"
trap 'rm -rf "${STAGING}" "${RW_DMG}"' EXIT

echo "[macos-dmg] 准备打包: $(basename "${DMG_PATH}") (卷标: ${VOLUME_NAME})"
cp -R "${APP_PATH}" "${STAGING}/"
ln -s /Applications "${STAGING}/Applications"

hdiutil create -srcfolder "${STAGING}" \
  -volname "${VOLUME_NAME}" \
  -fs HFS+ -format UDRW -ov -quiet "${RW_DMG}"

rm -f "${DMG_PATH}"
hdiutil convert "${RW_DMG}" -format UDZO -o "${DMG_PATH}" -quiet
echo "[OK] DMG 已生成: ${DMG_PATH} ($(du -h "${DMG_PATH}" | awk '{print $1}'))"
