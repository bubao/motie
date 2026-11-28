#!/usr/bin/env bash
# ==============================================================================
#  motie 发布向导 (Release Wizard)
#  测试预检 -> 版本推导 -> VERSION / package.json 同步 -> Release Notes -> git 动作
#
#  参考 hpic scripts/release.sh 的结构；与 hpic 的关键差异（对齐本项目约定）：
#    * git 提交 / 打 Tag / 推送 **默认只打印命令（dry-run）**，显式 `--commit` 才执行
#    * 无 CHANGELOG.md 时不强制预写，改从 git log 按 Conventional Commits 生成预览
#    * 同步对象为根目录 package.json（zitie 前后端同仓同版本）
#
#  用法:
#    scripts/release.sh              # 向导（dry-run，不产生任何 git 变更）
#    scripts/release.sh --commit     # 确认后真实写盘并提交 / 打 Tag / 推送
#    scripts/release.sh --skip-tests # 跳过测试预检
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

COMMIT=false
SKIP_TESTS=false
for arg in "$@"; do
    case "$arg" in
        --commit) COMMIT=true ;;
        --skip-tests) SKIP_TESTS=true ;;
        *) printf '[ERROR] 未知参数: %s（可选: --commit / --skip-tests）\n' "$arg" >&2; exit 2 ;;
    esac
done

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; GRAY='\033[0;90m'; NC='\033[0m'
info() { printf "${CYAN}[INFO]${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$*"; }
err()  { printf "${RED}[ERROR]${NC} %s\n" "$*" >&2; exit 1; }

echo ""
echo -e "${CYAN}======================================================${NC}"
echo -e "${CYAN}   motie 发布向导 (Release Wizard)                    ${NC}"
echo -e "${CYAN}======================================================${NC}"

# ---- 0. 分支 / 远程 ---------------------------------------------------------
CURRENT_BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo '')"
REMOTE_NAME="$(git remote | head -n 1 || echo '')"
if [[ -z "$REMOTE_NAME" ]] || ! git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
    err "未检测到 Git 远程仓库：请先配置 remote（git remote add origin <url>）"
fi
[[ -n "$CURRENT_BRANCH" ]] || err "当前不在任何分支上（detached HEAD），请先切回分支"
git fetch --tags "$REMOTE_NAME" >/dev/null 2>&1 || warn "git fetch --tags 失败（离线？）——继续，但远程 Tag 检查可能不准"
REMOTE_URL="$(git remote get-url "$REMOTE_NAME")"
GITHUB_REPO="$(printf '%s' "$REMOTE_URL" | sed -E 's/.*github\.com[:\/]([^\/]+\/[^\/\.]+).*/\1/' | sed 's/\.git$//')"
info "分支: ${CURRENT_BRANCH} | 远程: ${REMOTE_NAME} | 仓库: ${GITHUB_REPO:-未知}"

# ---- 1. 测试预检 -----------------------------------------------------------
if [[ "$SKIP_TESTS" == true ]]; then
    warn "已跳过测试预检（--skip-tests）"
else
    info "[1/5] 后端全量单元测试 (go test ./...)"
    if ! go test ./... >/dev/null 2>&1; then
        err "单元测试失败：请修复后重跑（查看细节：go test ./...）"
    fi
    ok "单元测试全部通过"
fi

# ---- 2. 版本推导 -----------------------------------------------------------
info "[2/5] 推导语义化版本号..."
LATEST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || echo '')"
BASE_VER="${LATEST_TAG#v}"; BASE_VER="${BASE_VER:-0.0.0}"

FILE_VER=""
[[ -f VERSION ]] && FILE_VER="$(tr -d '\r\n ' < VERSION | sed 's/^v//')"

FILE_VER_NOT_TAGGED=false
if [[ -n "$FILE_VER" ]]; then
    if ! git rev-parse "v${FILE_VER}" >/dev/null 2>&1 \
        && ! git ls-remote --tags "$REMOTE_NAME" "refs/tags/v${FILE_VER}" 2>/dev/null | grep -q "v${FILE_VER}"; then
        FILE_VER_NOT_TAGGED=true
    fi
fi

[[ -n "$LATEST_TAG" ]] && info "上一已发布 Tag: ${LATEST_TAG}" || info "未检测到历史 Git Tag（初始发布）"

IFS='.' read -r V_MAJOR V_MINOR V_PATCH <<< "$BASE_VER"
V_MAJOR="${V_MAJOR:-0}"; V_MINOR="${V_MINOR:-0}"; V_PATCH="${V_PATCH:-0}"
SUGGEST_PATCH="${V_MAJOR}.${V_MINOR}.$((V_PATCH + 1))"
SUGGEST_MINOR="${V_MAJOR}.$((V_MINOR + 1)).0"
SUGGEST_MAJOR="$((V_MAJOR + 1)).0.0"

if [[ "$FILE_VER_NOT_TAGGED" == true ]]; then
    info "VERSION 文件指定版本: ${FILE_VER}（尚未打 Tag）"
    echo "   [1] 发布 VERSION 指定版本 v${FILE_VER}（推荐，回车默认）"
    echo "   [2] 补丁升级 v${SUGGEST_PATCH}"
    echo "   [3] 特性升级 v${SUGGEST_MINOR}"
    echo "   [4] 重大升级 v${SUGGEST_MAJOR}"
    echo "   [5] 自定义版本号"
    read -r -p "选择升级策略 [1-5, 回车默认 1]: " CHOICE || CHOICE=""
    CHOICE="${CHOICE:-1}"
    case "$CHOICE" in
        1) TARGET_RAW_VER="$FILE_VER" ;;
        2) TARGET_RAW_VER="$SUGGEST_PATCH" ;;
        3) TARGET_RAW_VER="$SUGGEST_MINOR" ;;
        4) TARGET_RAW_VER="$SUGGEST_MAJOR" ;;
        5) read -r -p "请输入版本号（例如 0.1.0）: " TARGET_RAW_VER; TARGET_RAW_VER="${TARGET_RAW_VER#v}" ;;
        *) TARGET_RAW_VER="$FILE_VER" ;;
    esac
else
    info "当前已发布基准: v${BASE_VER}"
    echo "   [1] 补丁升级 v${SUGGEST_PATCH}（常规修复，推荐）"
    echo "   [2] 特性升级 v${SUGGEST_MINOR}"
    echo "   [3] 重大升级 v${SUGGEST_MAJOR}"
    echo "   [4] 自定义版本号"
    read -r -p "选择升级策略 [1-4, 回车默认 1]: " CHOICE || CHOICE=""
    CHOICE="${CHOICE:-1}"
    case "$CHOICE" in
        1) TARGET_RAW_VER="$SUGGEST_PATCH" ;;
        2) TARGET_RAW_VER="$SUGGEST_MINOR" ;;
        3) TARGET_RAW_VER="$SUGGEST_MAJOR" ;;
        4) read -r -p "请输入版本号（例如 0.1.0）: " TARGET_RAW_VER; TARGET_RAW_VER="${TARGET_RAW_VER#v}" ;;
        *) TARGET_RAW_VER="$SUGGEST_PATCH" ;;
    esac
fi

[[ "$TARGET_RAW_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || err "版本号格式非法: '${TARGET_RAW_VER}'（应为 x.y.z）"
TARGET_TAG="v${TARGET_RAW_VER}"
info "本次发布目标版本: ${TARGET_TAG}"

# ---- 3. Tag 重复检查（本地 + 远程） ----------------------------------------
TAG_EXISTS=false
git rev-parse "$TARGET_TAG" >/dev/null 2>&1 && TAG_EXISTS=true
if [[ "$TAG_EXISTS" != true ]]; then
    git ls-remote --tags "$REMOTE_NAME" "refs/tags/${TARGET_TAG}" 2>/dev/null | grep -q "${TARGET_TAG}" && TAG_EXISTS=true
fi
[[ "$TAG_EXISTS" == true ]] && err "Tag '${TARGET_TAG}' 已存在（本地或远程），不能重复发版"

# ---- 4. 单一真相源同步：VERSION + 根 package.json ---------------------------
info "[3/5] 单一真相源同步（VERSION / package.json）"
PKG_VER="$(node -e "process.stdout.write(require('./package.json').version)" 2>/dev/null || true)"
info "当前 package.json version: ${PKG_VER:-读取失败}"

SYNC_FILES=()
SYNC_FILES+=("VERSION")

write_version_files() {
    printf '%s\n' "$TARGET_RAW_VER" > VERSION
    node -e "
        const fs = require('fs');
        const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        p.version = '${TARGET_RAW_VER}';
        fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
    " || err "同步 package.json 失败（检查 Node 环境与写权限）"
    ok "已写入 VERSION -> ${TARGET_RAW_VER}"
    ok "已同步 package.json version -> ${TARGET_RAW_VER}"
}

if [[ "$COMMIT" == true ]]; then
    write_version_files
else
    printf "${GRAY}[DRY-RUN] 将写入 VERSION -> %s${NC}\n" "$TARGET_RAW_VER"
    printf "${GRAY}[DRY-RUN] 将同步 package.json version -> %s${NC}\n" "$TARGET_RAW_VER"
fi

# ---- 5. Release Notes ------------------------------------------------------
info "[4/5] Release Notes"
RELEASE_NOTES_BODY=""
HAS_CHANGELOG_SECTION=false
if [[ -f CHANGELOG.md ]]; then
    if node -e "
        const fs = require('fs');
        const c = fs.readFileSync('CHANGELOG.md', 'utf8');
        const has = c.includes('## [${TARGET_TAG}]') || c.includes('## [${TARGET_RAW_VER}]');
        process.exit(has ? 0 : 1);
    " 2>/dev/null; then
        HAS_CHANGELOG_SECTION=true
        RELEASE_NOTES_BODY="$(node -e "
            const fs = require('fs');
            const lines = fs.readFileSync('CHANGELOG.md', 'utf8').split('\n');
            let on = false; const out = [];
            for (const l of lines) {
                if (new RegExp('^##\\\\s+\\\\[(v)?${TARGET_RAW_VER}\\\\]').test(l)) { on = true; continue; }
                if (on && /^##\\\\s+\\[/.test(l)) break;
                if (on) out.push(l);
            }
            console.log(out.join('\n').trim());
        " 2>/dev/null || true)"
    fi
fi

if [[ "$HAS_CHANGELOG_SECTION" == true ]]; then
    ok "已从 CHANGELOG.md 提取 ${TARGET_TAG} 章节"
else
    # 无 CHANGELOG.md（或未预写该版本章节）：从 git log 按 Conventional Commits 生成预览
    FROM_REF="${LATEST_TAG}"
    if [[ -n "$FROM_REF" ]]; then
        RAW_LOGS="$(git log "${FROM_REF}..HEAD" --pretty=format:'%s|||%h' --no-merges 2>/dev/null || true)"
    else
        RAW_LOGS="$(git log -n 25 --pretty=format:'%s|||%h' --no-merges 2>/dev/null || true)"
    fi
    RELEASE_NOTES_BODY="$(printf '%s' "$RAW_LOGS" | awk -F'|||' '
        function trim(s){ gsub(/^[[:space:]]+|[[:space:]]+$/, "", s); return s }
        {
            msg = trim($1); if (msg == "") next
            low = tolower(msg)
            if (low ~ /^feat/) { feats = feats "- " msg "\n" }
            else if (low ~ /^fix/) { fixes = fixes "- " msg "\n" }
            else if (low ~ /^perf/) { perfs = perfs "- " msg "\n" }
            else if (low ~ /^refactor/) { refs = refs "- " msg "\n" }
            else { others = others "- " msg "\n" }
        }
        END {
            if (feats != "") print "### 新增特性\n" feats
            if (fixes != "") print "### 修复优化\n" fixes
            if (perfs != "") print "### 性能优化\n" perfs
            if (refs != "") print "### 重构\n" refs
            if (others != "") print "### 其他\n" others
        }')"
    if [[ -z "${RELEASE_NOTES_BODY}" ]]; then
        RELEASE_NOTES_BODY="- ${TARGET_TAG} 发布"
    fi
    info "未发现 CHANGELOG.md 章节，已按 Conventional Commits 从 git log 生成预览"
fi

echo -e "${GRAY}------------------- 本次发布说明 (Release Notes) -------------------${NC}"
printf '%s\n' "$RELEASE_NOTES_BODY"
echo -e "${GRAY}--------------------------------------------------------------------${NC}"

# ---- 6. 产物矩阵提示 -------------------------------------------------------
echo ""
info "[5/5] 产物矩阵（脚本不含打包，发版前按需执行）"
echo "   * macOS .app zip/dmg : make app-macos（DMG 需在终端交互会话生成）"
echo "   * Windows exe + Linux 包 : make goreleaser（或推 Tag 后由 CI 接管）"

# ---- 7. git 动作（默认 dry-run） -------------------------------------------
echo ""
echo -e "${YELLOW}======================================================${NC}"
echo -e "发布目标: ${GREEN}${TARGET_TAG}${NC}  分支: ${GREEN}${CURRENT_BRANCH}${NC} -> ${GREEN}${REMOTE_NAME}${NC}"
echo -e "${YELLOW}======================================================${NC}"
GIT_CMDS=(
    "git add VERSION package.json"
    "git commit -m \"release: ${TARGET_TAG}\""
    "git tag -a ${TARGET_TAG} -m \"Release ${TARGET_TAG}\""
    "git push ${REMOTE_NAME} ${CURRENT_BRANCH}"
    "git push ${REMOTE_NAME} ${TARGET_TAG}"
)

if [[ "$COMMIT" != true ]]; then
    echo -e "${YELLOW}[DRY-RUN] 未执行任何 git 操作。以下为待执行命令：${NC}"
    for c in "${GIT_CMDS[@]}"; do printf "${GRAY}   \$ %s${NC}\n" "$c"; done
    echo ""
    echo "确认无误后以 ${YELLOW}scripts/release.sh --commit${NC} 重新运行即可真实发布。"
    exit 0
fi

read -r -p "确认提交并推送发布？[y/N]: " CONFIRM || CONFIRM="N"
CONFIRM="${CONFIRM:-N}"
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "已取消本次发布（VERSION / package.json 已写入工作区但未提交；放弃请: git checkout -- VERSION package.json）"
    exit 0
fi

for c in "${GIT_CMDS[@]}"; do
    info "执行: $c"
    eval "$c"
done

echo ""
ok "发布流程完成：${TARGET_TAG} 已推送"
[[ -n "$GITHUB_REPO" ]] && info "Release 页面: https://github.com/${GITHUB_REPO}/releases/tag/${TARGET_TAG}"
echo ""
