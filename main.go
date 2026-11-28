// motie 桌面版入口：embed 前端产物、装配组合根、启动 HTTP 内核并拉起窗口壳。
//
// 构建注入版本：go build -ldflags "-X main.Version=<version> ..."；
// 版本真相源为仓库根 VERSION 文件，多源解析见 internal/version。
package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"motie/internal/app"
	"motie/internal/version"
)

//go:embed all:dist
var distFS embed.FS

//go:embed all:lite
var liteFS embed.FS

//go:embed VERSION
var embeddedVersion string

/* 动态构建信息，编译时可通过 -ldflags 覆盖注入（-X main.Version=v0.0.2）。 */
var (
	Version   = ""
	GitCommit = "dev"
	BuildDate = "unknown"
)

func init() {
	if Version == "" || Version == "dev" || Version == "unknown" {
		Version = version.ResolveVersion(embeddedVersion)
	}
	/* 双包同值：internal/version 的解析结果供 updater / 元信息统一读取 */
	version.Version = Version
	version.GitCommit = GitCommit
	version.BuildDate = BuildDate
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "motie:", err)
		os.Exit(1)
	}
}

func run() error {
	/* Windows GUI 子系统下重指标准流到父终端，保证日志可见（非 Windows 为空操作）。 */
	attachParentConsole()

	port := flag.Int("port", 0, "监听端口（默认取配置，再回退 39130）")
	bind := flag.String("bind", "", "监听地址（默认取配置 127.0.0.1）")
	flag.Parse()

	rootCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	defer stop()
	ctx, cancel := context.WithCancel(rootCtx)
	defer cancel()

	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return fmt.Errorf("内嵌前端产物缺失（先 npm run build）：%w", err)
	}
	liteSub, err := fs.Sub(liteFS, "lite")
	if err != nil {
		return fmt.Errorf("内嵌 lite 版本缺失：%w", err)
	}
	a, err := app.New(app.Options{WebFS: sub, LiteFS: liteSub, Version: Version})
	if err != nil {
		return err
	}
	defer func() { _ = a.Close() }()

	opts := Options{Port: *port, Bind: *bind}
	err = Run(ctx, a, opts, func(readyPort int) {
		url := windowURL(effectiveBind(*bind, a), readyPort)
		/* MOTIE_NO_WINDOW=1：CI / 自动化冒烟只起服务不拉窗口 */
		if os.Getenv("MOTIE_NO_WINDOW") != "" {
			fmt.Println("motie: 已跳过拉起窗口（MOTIE_NO_WINDOW）：", url)
			return
		}
		proc, werr := openWindow(ctx, url)
		if werr != nil {
			fmt.Fprintln(os.Stderr, "motie: 打开窗口失败：", werr, "（可手动访问 "+url+"）")
			return
		}
		watchExit(proc, cancel)
	})
	if errors.Is(err, ErrAlreadyRunning) {
		/* 已有实例：为其打开新窗口后退出（服务由既有实例继续提供）。
		 * 实例可能因默认端口被占而顺延运行，优先用错误携带的实际端口构造地址。 */
		runPort := effectivePort(*port, a)
		var already *AlreadyRunningError
		if errors.As(err, &already) {
			runPort = already.Port
		}
		serveURL := windowURL(effectiveBind(*bind, a), runPort)
		fmt.Fprintf(os.Stderr, "motie: 已有一个 motie 实例在运行（端口 %d）：%s\n", runPort, serveURL)
		/* 与首进程一致：MOTIE_NO_WINDOW 时只报告不拉窗口（CI / 无头环境语义统一） */
		if os.Getenv("MOTIE_NO_WINDOW") != "" {
			fmt.Println("motie: 已跳过为既有实例拉起窗口（MOTIE_NO_WINDOW）")
			return nil
		}
		_, werr := openWindow(context.Background(), serveURL)
		return werr
	}
	return err
}

/* watchExit 窗口关闭即取消主 Context，让服务随之收尾，避免孤儿进程。 */
func watchExit(proc *windowProc, cancel context.CancelFunc) {
	if proc == nil {
		return
	}
	go func() {
		select {
		case <-proc.Done():
			cancel()
		}
	}()
}

func effectiveBind(flagBind string, a *app.App) string {
	if flagBind != "" {
		return flagBind
	}
	cfg, err := a.Config.Get()
	if err != nil || cfg.BindAddr == "" {
		return "127.0.0.1"
	}
	return cfg.BindAddr
}

func effectivePort(flagPort int, a *app.App) int {
	if flagPort != 0 {
		return flagPort
	}
	cfg, err := a.Config.Get()
	if err != nil || cfg.DefaultPort == 0 {
		return 39130
	}
	return cfg.DefaultPort
}

/* clientHost 把监听地址映射为客户端可直连的主机名，供窗口 URL 与实例探测共用：
 *   - 通配监听 0.0.0.0 / :: → 具体回环地址（0.0.0.0 作为目的地址在部分平台不可达，
 *     且 IPv6 通配应对应 IPv6 回环，避免双栈差异）；
 *   - localhost → 127.0.0.1（避免解析到 ::1 与 IPv4 监听不匹配）；
 *   - 明确的 ::1 / [::1] 保持 IPv6 族（原实现把 ::1 转成 127.0.0.1，连不上纯 IPv6 监听）。 */
func clientHost(bind string) string {
	switch bind {
	case "", "localhost", "0.0.0.0":
		return "127.0.0.1"
	case "::", "::1", "[::1]":
		return "::1"
	}
	return bind
}

func windowURL(bind string, port int) string {
	return fmt.Sprintf("http://%s/", net.JoinHostPort(clientHost(bind), strconv.Itoa(port)))
}
