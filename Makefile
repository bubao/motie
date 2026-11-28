# =============================================================================
# 墨帖 motie — 自动化构建 & 发版
# =============================================================================

.PHONY: all help \
        build build-frontend test test-backend test-frontend \
        lint fmt generate check-contract \
        run dist clean version ci release release-check \
        gen-assets gen-resources gen-windows-resources gen-linux-icons swift-ui \
        package app-macos app-windows app-linux \
        native-linux native-windows \
        goreleaser goreleaser-snapshot

BINARY_NAME := motie
BIN_DIR     := bin
DIST_DIR    := dist-desktop
VERSION     ?= $(shell (cat VERSION 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || echo "0.0.1") | tr -d '\r\n ' | sed 's/^v//')
GIT_COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "dev")
BUILD_DATE  ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
# main.* 与 internal/version.* 双包同注入，保证启动日志 / REST 元信息 / updater 口径一致
LDFLAGS     := -s -w \
               -X main.Version=$(VERSION) -X main.GitCommit=$(GIT_COMMIT) -X main.BuildDate=$(BUILD_DATE) \
               -X motie/internal/version.Version=$(VERSION) -X motie/internal/version.GitCommit=$(GIT_COMMIT) -X motie/internal/version.BuildDate=$(BUILD_DATE)

BLUE    := \033[0;34m
GREEN   := \033[0;32m
YELLOW  := \033[0;33m
RED     := \033[0;31m
CYAN    := \033[0;36m
RESET   := \033[0m

all: build

help:
	@echo ""
	@echo "$(CYAN)=================== 墨帖 motie — 可用命令 ===================$(RESET)"
	@echo ""
	@echo "  $(GREEN)[开发]$(RESET)"
	@echo "    make build            构建二进制到 bin/（前端变动自动重新打包）"
	@echo "    make build-frontend   仅构建前端静态产物"
	@echo "    make run              构建并启动桌面应用"
	@echo ""
	@echo "  $(GREEN)[质量]$(RESET)"
	@echo "    make test             全量测试（Go -race + 前端 vitest）"
	@echo "    make test-backend     仅 Go 测试"
	@echo "    make test-frontend    仅前端测试"
	@echo "    make lint             Go 静态检查（go vet）"
	@echo "    make fmt              格式化 Go 代码（gofmt -l -w）"
	@echo "    make generate         生成前后端契约（typegen）"
	@echo "    make check-contract   校验契约无漂移"
	@echo ""
	@echo "  $(GREEN)[打包发版]$(RESET)"
	@echo "    make gen-resources    生成全部打包资源（品牌资产 / Windows syso / Linux 图标）"
	@echo "    make native-linux     构建 Linux 原生壳 build/motie-shell（需目标机 GTK3 + WebKit2GTK）"
	@echo "    make native-windows   构建 Windows 原生壳 build/motie-shell.exe（需目标机 .NET 8 SDK）"
	@echo "    make app-macos        打包 macOS（Motie.app zip + dmg，分架构）"
	@echo "    make app-windows      打包 Windows（GUI exe + 便携 zip + NSIS 安装器）"
	@echo "    make app-linux        打包 Linux 二进制（amd64/arm64）"
	@echo "    make package          本机可打包的全部目标（macOS 本机 + Windows + Linux）"
	@echo "    make goreleaser-snapshot  快照打包（不发布，产物 .goreleaser-dist/）"
	@echo "    make goreleaser       正式发版（需已打 tag）"
	@echo "    make release          发版向导（默认 dry-run；真实发布: make release ARGS=--commit）"
	@echo ""
	@echo "  $(GREEN)[其他]$(RESET)"
	@echo "    make dist             交叉编译三平台二进制到 $(DIST_DIR)/"
	@echo "    make version          显示当前版本号"
	@echo "    make ci               发版前完整检查（fmt + lint + contract + test + build）"
	@echo "    make release-check    ci + goreleaser-snapshot"
	@echo "    make clean            清理全部构建产物"
	@echo ""

# -----------------------------------------------------------------------------
# 构建
# -----------------------------------------------------------------------------

build: build-frontend
	@mkdir -p $(BIN_DIR)
	@tmp_bin=$$(mktemp "/tmp/motie_bin.XXXXXX"); \
	go build -ldflags="$(LDFLAGS)" -o $$tmp_bin .; \
	if [ "$$(uname -s)" = "Darwin" ]; then \
		codesign --force --options runtime --sign - $$tmp_bin 2>/dev/null || true; \
	fi; \
	mv -f $$tmp_bin $(BIN_DIR)/$(BINARY_NAME)
	@echo "$(GREEN)[OK]$(RESET) 构建完成: ./$(BIN_DIR)/$(BINARY_NAME)"

build-frontend:
	@echo "$(BLUE)[INFO]$(RESET) 编译前端静态产物 (离线 vendor 模式)..."
	@if [ ! -d node_modules ]; then \
		echo "   $(BLUE)[INFO]$(RESET) 安装前端依赖 (npm install)..."; \
		npm install; \
	fi
	@if [ ! -s web/vendor/hanzi-writer.min.js ] || [ ! -s web/vendor/pinyin-pro.esm.js ]; then \
		echo "   $(BLUE)[INFO]$(RESET) 下载本地 vendor 资源 (npm run vendor)..."; \
		npm run vendor; \
	fi
	@npm run build -- --vendor
	@test -s dist/index.html || (echo "$(RED)[ERROR]$(RESET) 前端产物 dist/index.html 缺失！"; exit 1)
	@test -s lite/index.html || (echo "$(RED)[ERROR]$(RESET) lite 产物 lite/index.html 缺失！"; exit 1)
	@test -s dist/vendor/hanzi-writer.min.js || (echo "$(RED)[ERROR]$(RESET) 离线资源 dist/vendor/ 缺失！"; exit 1)

run: build
	@./$(BIN_DIR)/$(BINARY_NAME)

# -----------------------------------------------------------------------------
# 质量
# -----------------------------------------------------------------------------

test: test-backend test-frontend

test-backend:
	@echo "$(BLUE)[INFO]$(RESET) Go 全量测试（-race）..."
	@go test -race ./...

test-frontend: build-frontend
	@echo "$(BLUE)[INFO]$(RESET) 前端测试（node 脚本 + vitest）..."
	@npm test

lint:
	@echo "$(BLUE)[INFO]$(RESET) go vet ./...（另含三平台交叉 vet）..."
	@go vet ./...
	@CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go vet ./... || true
	@CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go vet ./... || true

fmt:
	@gofmt -l -w .

generate:
	@go run ./cmd/typegen

check-contract:
	@go run ./cmd/typegen -check

# -----------------------------------------------------------------------------
# 打包资源
# -----------------------------------------------------------------------------

gen-assets:
	@echo "$(BLUE)[INFO]$(RESET) 代码化生成品牌资产 (appicon.png, app.ico, app.manifest)..."
	@go run ./scripts/gen-assets.go

gen-windows-resources:
	@./scripts/gen-windows-resources.sh

gen-linux-icons:
	@./scripts/gen-linux-icons.sh

gen-resources: gen-assets gen-windows-resources gen-linux-icons

swift-ui:
	@command -v swiftc >/dev/null 2>&1 || (echo "$(RED)[ERROR]$(RESET) 未检测到 swiftc（仅 macOS 可用）"; exit 1)
	@mkdir -p build/swift-ui
	@swiftc -O -o build/swift-ui/motie-shell native_macos/main.swift
	@echo "$(GREEN)[OK]$(RESET) 原生窗口启动器: build/swift-ui/motie-shell"

# Linux / Windows 原生壳需在对应平台构建（本机 macOS 无法编译）：
# 产物与内核同目录，内核按 <exeDir>/motie-shell(.exe) 自动拉起。详见 doc/native-shells.md
native-linux:
	@native_linux/build-linux-shell.sh

native-windows:
	@powershell -ExecutionPolicy Bypass -File native_windows/build-windows-shell.ps1

# -----------------------------------------------------------------------------
# 打包发版
# -----------------------------------------------------------------------------

package: build-frontend
	@./scripts/package.sh all $(VERSION)

app-macos: build-frontend
	@./scripts/package.sh macos $(VERSION) all

app-windows: build-frontend
	@./scripts/package.sh windows $(VERSION)

app-linux: build-frontend
	@./scripts/package.sh linux $(VERSION)

goreleaser-snapshot: build-frontend generate
	@command -v goreleaser >/dev/null 2>&1 || (echo "$(RED)[ERROR]$(RESET) 未检测到 goreleaser: https://goreleaser.com/install/"; exit 1)
	@goreleaser release --clean --snapshot
	@rm -f motie_windows_*.syso
	@echo "$(GREEN)[OK]$(RESET) 快照构建完成，产物位于 .goreleaser-dist/"

# 发版向导：默认只推导版本 / 校验 / 打印待执行命令；ARGS="--commit" 才写盘并提交
release:
	@bash scripts/release.sh $(ARGS)

goreleaser: build-frontend generate
	@command -v goreleaser >/dev/null 2>&1 || (echo "$(RED)[ERROR]$(RESET) 未检测到 goreleaser: https://goreleaser.com/install/"; exit 1)
	@goreleaser release --clean
	@rm -f motie_windows_*.syso

# -----------------------------------------------------------------------------
# 交叉编译（快速验证）
# -----------------------------------------------------------------------------

dist: build-frontend gen-resources
	@mkdir -p $(DIST_DIR)
	@CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="$(LDFLAGS) -H=windowsgui" -o $(DIST_DIR)/motie-$(VERSION)-windows-amd64.exe .
	@rm -f motie_windows_*.syso
	@CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="$(LDFLAGS)" -o $(DIST_DIR)/motie-$(VERSION)-linux-amd64 .
	@CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="$(LDFLAGS)" -o $(DIST_DIR)/motie-$(VERSION)-linux-arm64 .
	@if [ "$$(uname -s)" = "Darwin" ]; then \
		CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="$(LDFLAGS)" -o $(DIST_DIR)/motie-$(VERSION)-darwin-arm64 .; \
		codesign --force --options runtime --sign - $(DIST_DIR)/motie-$(VERSION)-darwin-arm64 2>/dev/null || true; \
	fi
	@echo "$(GREEN)[OK]$(RESET) $(DIST_DIR)/ 交叉编译完成（正式版请用 make app-macos / app-windows / app-linux）"

# -----------------------------------------------------------------------------
# 汇总检查
# -----------------------------------------------------------------------------

version:
	@echo "$(VERSION)"

ci: fmt lint check-contract test-backend test-frontend build

release-check: ci goreleaser-snapshot

# -----------------------------------------------------------------------------
# 清理
# -----------------------------------------------------------------------------

clean:
	@rm -rf $(BIN_DIR) $(DIST_DIR) build
	@rm -f motie_windows_*.syso
	@echo "$(GREEN)[OK]$(RESET) 构建产物已清理"
