#!/usr/bin/env bash
# =============================================================================
# gen-linux-icons.sh — 由图标母版生成 Linux hicolor 主题 PNG 图标集
#
# 输出：build/icons/hicolor/<size>x<size>/apps/motie.png
#
# 工具优先级：sips（macOS 系统自带） > magick（ImageMagick 7） > convert（ImageMagick 6）
# 用法：
#   scripts/gen-linux-icons.sh            # 输出到 build/icons/hicolor
#   ICON_OUT_DIR=/tmp/icons scripts/gen-linux-icons.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SRC="build/appicon.png"
OUT_DIR="${ICON_OUT_DIR:-build/icons/hicolor}"
SIZES=(16 22 24 32 48 64 128 256 512)

# 自动生成缺失的品牌资产
if [[ ! -f "${SRC}" ]]; then
  echo "[gen-linux-icons] 自动生成品牌资产 (scripts/gen-assets.go)..."
  go run "${ROOT}/scripts/gen-assets.go" "${ROOT}"
fi

[[ -f "${SRC}" ]] || { echo "[ERROR] 缺少图标母版: ${SRC}" >&2; exit 1; }

if command -v sips >/dev/null 2>&1; then
  TOOL="sips"
elif command -v magick >/dev/null 2>&1; then
  TOOL="magick"
elif command -v convert >/dev/null 2>&1; then
  TOOL="convert"
else
  echo "[ERROR] 未找到 sips / magick / convert，无法生成 Linux 图标。" >&2
  echo "       请安装 ImageMagick（如: brew install imagemagick 或 apt-get install imagemagick）" >&2
  exit 1
fi

echo "[gen-linux-icons] 使用 ${TOOL} 生成 hicolor 图标集 ..."
for SIZE in "${SIZES[@]}"; do
  DIR="${OUT_DIR}/${SIZE}x${SIZE}/apps"
  mkdir -p "${DIR}"
  case "${TOOL}" in
    sips)
      sips -z "${SIZE}" "${SIZE}" "${SRC}" --out "${DIR}/motie.png" >/dev/null
      ;;
    magick)
      magick "${SRC}" -resize "${SIZE}x${SIZE}" "${DIR}/motie.png"
      ;;
    convert)
      convert "${SRC}" -resize "${SIZE}x${SIZE}" "${DIR}/motie.png"
      ;;
  esac
done

echo "[gen-linux-icons] 完成，共 ${#SIZES[@]} 个尺寸 → ${OUT_DIR}"
