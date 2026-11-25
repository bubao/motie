#!/usr/bin/env bash
# =============================================================================
# package.sh — motie 桌面应用统一打包入口
#
# 用法：
#   scripts/package.sh <macos|windows|linux|all> [version] [arch]
#
#   version  省略时取 git 最新 tag（去掉 v 前缀），否则 0.1.0
#   arch     仅 macos：arm64 / amd64 / all（默认 all）
#
# 前置：前端产物 dist/ 与 lite/ 已由 `npm run build -- --vendor`（离线模式）生成（SKIP_FRONTEND=1 可跳过该检查）
#        ——必须带 --vendor，否则 embed 的 dist/ 不含 vendor/，分发包断网时笔画 / 拼音会回退 CDN
#
# 产物（dist/）：
#   macOS   Motie-<version>-macOS-<arch>.zip / .dmg（ad-hoc 签名；可经 APPLE_SIGN_IDENTITY 覆盖）
#   Windows motie-<version>-windows-amd64.exe / -portable.zip / -setup.exe（NSIS 可用时）
#   Linux   motie-<version>-linux-<arch>（图标由 gen-linux-icons.sh 生成）
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-all}"
VERSION="${2:-$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "0.1.0")}"
ARCH_ARG="${3:-all}"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; RESET='\033[0m'
info() { printf "${BLUE}[INFO]${RESET} %s\n" "$*"; }
ok()   { printf "${GREEN}[OK]${RESET} %s\n" "$*"; }
warn() { printf "${YELLOW}[WARN]${RESET} %s\n" "$*"; }
err()  { printf "${RED}[ERROR]${RESET} %s\n" "$*" >&2; exit 1; }

DIST_DIR="$ROOT/dist-desktop"
mkdir -p "$DIST_DIR"
LDFLAGS="-s -w -X main.Version=$VERSION"

[[ -f dist/index.html ]] || err "缺少前端产物 dist/index.html，请先执行 npm run build -- --vendor"
[[ -d dist/vendor ]] || err "缺少离线资源 dist/vendor/，请改用 npm run build -- --vendor 重新构建"

case "$TARGET" in
  macos | windows | linux | all) ;;
  *) err "未知目标: $TARGET（可选: macos / windows / linux / all）" ;;
esac

# -----------------------------------------------------------------------------
# macOS：Motie.app（arm64/amd64 分架构）→ zip + dmg
# -----------------------------------------------------------------------------
package_macos() {
  local arches=()
  # 空白参数（如 " "）经 read -a 会得到空数组，同样触发 bash 3.2 nounset；一并归一为 all
  if [[ "$ARCH_ARG" == "all" || -z "${ARCH_ARG//[[:space:]]/}" ]]; then
    arches=("arm64" "amd64")
  else
    read -r -a arches <<< "$ARCH_ARG"
  fi

  for arch in "${arches[@]}"; do
    info "[macOS] 构建 darwin/$arch ..."
    local out_dir="$ROOT/build/macos-$arch"
    rm -rf "$out_dir"; mkdir -p "$out_dir/swift-ui"

    CGO_ENABLED=0 GOOS=darwin GOARCH="$arch" \
      go build -ldflags="$LDFLAGS" -o "$out_dir/motie" .

    if command -v swiftc >/dev/null 2>&1; then
      if swiftc -O -o "$out_dir/swift-ui/motie-shell" "$ROOT/native_macos/main.swift" 2>/dev/null; then
        ok "原生窗口启动器就绪 ($arch)"
      else
        warn "swiftc 编译失败，运行期将回退 Chromium --app 模式 ($arch)"
      fi
    else
      warn "未检测到 swiftc，运行期将回退 Chromium --app 模式 ($arch)"
    fi

    # 原生启动器可选：存在则注入 SWIFT_UI_BIN，缺失 / 编译失败时回退 Chromium --app。
    # 用 if 分支而非空数组展开：bash 3.2 + set -u 下 "${arr[@]}" 为空会报 unbound variable
    # 并因 set -e 中断打包，导致回退分支永远执行不到。
    local app_src
    if [[ -f "$out_dir/swift-ui/motie-shell" ]]; then
      app_src=$(SWIFT_UI_BIN="$out_dir/swift-ui/motie-shell" bash "$ROOT/scripts/macos-app-bundle.sh" "$out_dir/motie" "$VERSION" darwin "$arch")
    else
      app_src=$(bash "$ROOT/scripts/macos-app-bundle.sh" "$out_dir/motie" "$VERSION" darwin "$arch")
    fi

    if [[ -n "${APPLE_SIGN_IDENTITY:-}" ]]; then
      info "使用 Developer ID 签名 .app: $APPLE_SIGN_IDENTITY"
      codesign --force --deep --options runtime --sign "$APPLE_SIGN_IDENTITY" "$app_src"
    fi

    local zip_name="Motie-${VERSION}-macOS-${arch}.zip"
    info "生成 zip: $zip_name"
    ditto -c -k --sequesterRsrc --keepParent "$app_src" "$DIST_DIR/$zip_name"

    local dmg_name="Motie-${VERSION}-macOS-${arch}.dmg"
    info "生成 dmg: $dmg_name"
    if ! bash "$ROOT/scripts/macos-dmg.sh" "$app_src" "$DIST_DIR/$dmg_name" Motie; then
      warn "DMG 生成失败（zip 可用）；若在非交互会话中运行属已知系统限制，请在终端重试"
    fi
  done
  ok "[macOS] 打包完成 -> $DIST_DIR"
}

# -----------------------------------------------------------------------------
# Windows：GUI 无控制台黑框 exe + 便携 zip + NSIS 安装器（可选）
# -----------------------------------------------------------------------------
package_windows() {
  local arch="amd64"
  info "[Windows] 生成 PE 资源（图标 + 清单）..."
  RSRC_ARCH="$arch" bash "$ROOT/scripts/gen-windows-resources.sh"
  # syso 必须在构建期间存在，构建后立即清理，避免污染工作区
  trap 'rm -f "$ROOT/motie_windows_*.syso"' RETURN

  local exe_name="motie-${VERSION}-windows-${arch}.exe"
  local exe_path="$DIST_DIR/$exe_name"
  info "[Windows] 构建 GOOS=windows/amd64 (ldflags -H=windowsgui)..."
  CGO_ENABLED=0 GOOS=windows GOARCH="$arch" \
    go build -ldflags="$LDFLAGS -H=windowsgui" -o "$exe_path" .
  ok "Windows GUI 程序: $exe_path"

  local portable_zip="$DIST_DIR/motie-${VERSION}-windows-${arch}-portable.zip"
  local stage; stage=$(mktemp -d)
  cp "$exe_path" "$stage/motie.exe"
  (cd "$stage" && zip -q -9 "$portable_zip" motie.exe)
  rm -rf "$stage"
  ok "便携包: $portable_zip"

  if command -v makensis >/dev/null 2>&1; then
    local setup_exe="$DIST_DIR/motie-${VERSION}-windows-${arch}-setup.exe"
    info "[Windows] 编译 NSIS 安装器..."
    if makensis -DVERSION="$VERSION" -DEXE_SRC="$exe_path" -DOUT_FILE="$setup_exe" \
        "$ROOT/scripts/installer.nsi" >/dev/null; then
      ok "安装器: $setup_exe"
    else
      warn "NSIS 编译失败，已降级使用便携包分发"
    fi
  else
    warn "未检测到 makensis，已降级使用便携包分发"
  fi
}

# -----------------------------------------------------------------------------
# Linux：二进制（amd64/arm64）+ hicolor 图标
# -----------------------------------------------------------------------------
package_linux() {
  local archs=("amd64" "arm64")
  info "[Linux] 生成桌面图标..."
  bash "$ROOT/scripts/gen-linux-icons.sh"

  for arch in "${archs[@]}"; do
    local bin_name="motie-${VERSION}-linux-${arch}"
    info "[Linux] 构建 GOOS=linux/$arch ..."
    CGO_ENABLED=0 GOOS=linux GOARCH="$arch" \
      go build -ldflags="$LDFLAGS" -o "$DIST_DIR/$bin_name" .
    ok "Linux 二进制: $DIST_DIR/$bin_name"
  done
}

# -----------------------------------------------------------------------------
# 入口：函数定义完毕后按目标派发
# -----------------------------------------------------------------------------
case "$TARGET" in
  macos)   package_macos ;;
  windows) package_windows ;;
  linux)   package_linux ;;
  all)
    if [[ "$(uname -s)" == "Darwin" ]]; then package_macos; fi
    package_windows
    package_linux
    ;;
esac
