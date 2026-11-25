#!/usr/bin/env bash
# =============================================================================
# gen-windows-resources.sh — 生成 Windows PE 资源对象（图标 + 应用清单）
#
# 输出 motie_windows_<arch>.syso 到项目根目录，Go 工具链在构建 Windows
# 目标时自动识别并链接该资源（不影响 darwin / linux 构建）。
#
# 依赖：github.com/akavel/rsrc（缺失时自动 go install）
# 用法：
#   scripts/gen-windows-resources.sh            # 默认 amd64
#   RSRC_ARCH=arm64 scripts/gen-windows-resources.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ICO="build/app.ico"
MANIFEST="build/app.manifest"
ARCH="${RSRC_ARCH:-amd64}"
OUT="motie_windows_${ARCH}.syso"

# 自动生成缺失的品牌资产
if [[ ! -f "$ICO" || ! -f "$MANIFEST" ]]; then
  echo "[INFO] 自动生成品牌资产 (scripts/gen-assets.go)..."
  go run "${ROOT}/scripts/gen-assets.go" "${ROOT}"
fi

[ -f "$ICO" ] || { echo "[ERROR] 缺少 Windows 图标文件: $ICO" >&2; exit 1; }
[ -f "$MANIFEST" ] || { echo "[ERROR] 缺少 Windows 清单文件: $MANIFEST" >&2; exit 1; }
case "$ARCH" in
  amd64 | arm64 | arm | 386) ;;
  *) echo "[ERROR] 不支持的架构: $ARCH（可选: 386/amd64/arm/arm64）" >&2; exit 1 ;;
esac

resolve_rsrc_bin() {
  if command -v rsrc >/dev/null 2>&1; then
    command -v rsrc
    return 0
  fi
  local gopath
  gopath="$(go env GOPATH 2>/dev/null | cut -d: -f1)"
  if [[ -n "$gopath" && -x "${gopath}/bin/rsrc" ]]; then
    echo "${gopath}/bin/rsrc"
    return 0
  fi
  local gobin
  gobin="$(go env GOBIN 2>/dev/null || true)"
  if [[ -n "$gobin" && -x "${gobin}/rsrc" ]]; then
    echo "${gobin}/rsrc"
    return 0
  fi
  return 1
}

RSRC_BIN="$(resolve_rsrc_bin || true)"

if [ -z "$RSRC_BIN" ] || [ ! -x "$RSRC_BIN" ]; then
  echo "[INFO] 安装 rsrc 工具 (github.com/akavel/rsrc)..."
  go install github.com/akavel/rsrc@latest
  RSRC_BIN="$(resolve_rsrc_bin || true)"
fi

if [ -z "$RSRC_BIN" ] || [ ! -x "$RSRC_BIN" ]; then
  echo "[ERROR] 无法定位 rsrc 可执行文件，请检查 PATH 或 GOPATH/bin" >&2
  exit 1
fi

echo "[INFO] 生成 $OUT (icon=$ICO, manifest=$MANIFEST, arch=$ARCH)..."
rm -f "$OUT"
"$RSRC_BIN" -ico "$ICO" -manifest "$MANIFEST" -arch "$ARCH" -o "$OUT"

[ -s "$OUT" ] || { echo "[ERROR] rsrc 未生成有效资源文件: $OUT" >&2; exit 1; }
echo "[OK] Windows 资源已生成: $OUT ($(du -h "$OUT" | awk '{print $1}'))"
