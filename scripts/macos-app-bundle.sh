#!/usr/bin/env bash
# =============================================================================
# macos-app-bundle.sh — 将 Go 编译产物封装为 macOS .app Bundle
#
# 将单个架构的 darwin 二进制封装成标准 .app：
#   <dir>/Motie.app
#     Contents/
#       Info.plist
#       MacOS/motie            （Go 内核：HTTP 服务 + 窗口拉起）
#       MacOS/motie-shell      （可选：Swift WKWebView 原生窗口启动器）
#       Resources/AppIcon.icns
#
# 参数：
#   $1 - 二进制路径
#   $2 - 版本号
#   $3 - 目标 OS（仅支持 darwin，其他平台静默跳过）
#   $4 - 目标架构（arm64 / amd64）
#
# 环境变量：
#   SWIFT_UI_BIN       原生窗口启动器可执行文件（存在则嵌入 .app/Contents/MacOS/）
#   CACHED_ICNS        直接复用的 AppIcon.icns 路径
#   EXPORT_CACHED_ICNS 生成成功后的 icns 导出路径（供后续架构复用）
# =============================================================================
set -euo pipefail

BINARY_PATH="$1"
VERSION="$2"
TARGET_OS="$3"
TARGET_ARCH="${4:-$(uname -m)}"

if [[ "${TARGET_OS}" != "darwin" ]]; then
  exit 0
fi

APP_NAME="Motie"
BUNDLE_ID="com.bubao.motie"
MIN_OS_VERSION="11.0"

BUILD_DIR="$(dirname "${BINARY_PATH}")"
APP_DIR="${BUILD_DIR}/${APP_NAME}.app"
CONTENTS_DIR="${APP_DIR}/Contents"
# 注意：目录名必须是 MacOS（大写 OS）。
# 写成 Macos 在大小写不敏感文件系统上能访问，但 codesign 签名/校验会报
# "a sealed resource is missing or invalid"（sealed 路径与规范路径不一致）。
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"

echo "[macos-app-bundle] Building .app for darwin/${TARGET_ARCH} (version ${VERSION})" >&2

rm -rf "${APP_DIR}"
mkdir -p "${MACOS_DIR}" "${RESOURCES_DIR}"

cp "${BINARY_PATH}" "${MACOS_DIR}/motie"
chmod +x "${MACOS_DIR}/motie"

# ---- 嵌入内置原生窗口启动器（Swift + WKWebView）----
# 由打包流程通过 SWIFT_UI_BIN 传入；缺失时静默跳过，
# 运行期自动回退到 Chromium --app 模式（见 desktop_darwin.go）。
if [[ -n "${SWIFT_UI_BIN:-}" && -f "${SWIFT_UI_BIN}" ]]; then
  cp "${SWIFT_UI_BIN}" "${MACOS_DIR}/motie-shell"
  chmod +x "${MACOS_DIR}/motie-shell"
  echo "[macos-app-bundle] Native window launcher embedded: motie-shell" >&2
fi

# ---- Info.plist ----
cat > "${CONTENTS_DIR}/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>zh_CN</string>
    <key>CFBundleExecutable</key>
    <string>motie</string>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}</string>
    <key>CFBundleName</key>
    <string>墨帖</string>
    <key>CFBundleDisplayName</key>
    <string>墨帖</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleSignature</key>
    <string>????</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleGetInfoString</key>
    <string>墨帖 ${VERSION}</string>
    <key>LSMinimumSystemVersion</key>
    <string>${MIN_OS_VERSION}</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.education</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon.icns</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSRequiresAquaSystemAppearance</key>
    <false/>
    <key>NSHumanReadableCopyright</key>
    <string>Copyright © 2026 Motie. MIT License.</string>
    <key>NSSupportsAutomaticGraphicsSwitching</key>
    <true/>
    <!-- WKWebView 加载本地 HTTP 服务（http://127.0.0.1:<port>/）需要 ATS 例外，
         否则 App Transport Security 会阻断明文 HTTP 加载，窗口保持白屏。 -->
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key>
        <true/>
        <key>NSExceptionDomains</key>
        <dict>
            <key>localhost</key>
            <dict>
                <key>NSExceptionAllowsInsecureHTTPLoads</key>
                <true/>
            </dict>
        </dict>
    </dict>
</dict>
</plist>
PLIST

printf 'APPL????' > "${CONTENTS_DIR}/PkgInfo"

# ---- 生成或复用 AppIcon.icns（仅 macOS + 存在图标母版时）----
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ICON_PNG="${ROOT_DIR}/build/appicon.png"
ICON_ICNS="${RESOURCES_DIR}/AppIcon.icns"

if [[ ! -f "${ICON_PNG}" && -f "${ROOT_DIR}/scripts/gen-assets.go" ]]; then
  echo "[macos-app-bundle] 自动生成品牌资产 (scripts/gen-assets.go)..." >&2
  go run "${ROOT_DIR}/scripts/gen-assets.go" "${ROOT_DIR}" >&2 || true
fi

if [[ -n "${CACHED_ICNS:-}" && -f "${CACHED_ICNS}" ]]; then
  cp "${CACHED_ICNS}" "${ICON_ICNS}"
  echo "[macos-app-bundle] Icon reused from cache: ${CACHED_ICNS}" >&2
elif [[ "$(uname -s)" == "Darwin" ]] && [[ -f "${ICON_PNG}" ]]; then
  ICONSET_DIR="${BUILD_DIR}/AppIcon.iconset"
  rm -rf "${ICONSET_DIR}"
  mkdir -p "${ICONSET_DIR}"

  for SIZE in 16 32 64 128 256 512; do
    sips -z "${SIZE}" "${SIZE}" "${ICON_PNG}" --out "${ICONSET_DIR}/icon_${SIZE}x${SIZE}.png" >/dev/null 2>&1 || true
    sips -z "$((SIZE * 2))" "$((SIZE * 2))" "${ICON_PNG}" --out "${ICONSET_DIR}/icon_${SIZE}x${SIZE}@2x.png" >/dev/null 2>&1 || true
  done

  if iconutil -c icns "${ICONSET_DIR}" -o "${ICON_ICNS}" 2>/dev/null && [[ -f "${ICON_ICNS}" ]]; then
    echo "[macos-app-bundle] Icon generated: ${ICON_ICNS}" >&2
    if [[ -n "${EXPORT_CACHED_ICNS:-}" ]]; then
      cp "${ICON_ICNS}" "${EXPORT_CACHED_ICNS}" 2>/dev/null || true
    fi
  else
    echo "[macos-app-bundle] Icon generation skipped (iconutil unavailable)" >&2
  fi
  rm -rf "${ICONSET_DIR}"
else
  echo "[macos-app-bundle] Icon generation skipped (not on macOS or build/appicon.png missing)" >&2
fi

# ---- ad-hoc 签名（最终签名由打包流程统一处理）----
if [[ "$(uname -s)" == "Darwin" ]]; then
  codesign --force --options runtime --sign - "${APP_DIR}" 2>/dev/null || \
    echo "[macos-app-bundle] Warning: ad-hoc codesign failed (non-fatal)" >&2
fi

echo "${APP_DIR}"
