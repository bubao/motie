// motie 桌面版入口：embed 前端产物、装配组合根、启动 HTTP 内核并拉起窗口壳。
//
// 构建注入版本：go build -ldflags "-X main.Version=<version>"
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
)

//go:embed all:dist
var distFS embed.FS

//go:embed all:lite
var liteFS embed.FS

// Version 与 internal/version 同名同值；发布时以 -X main.Version 注入。
var Version = "0.0.1"

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
		/* 已有实例：为其打开新窗口后退出（服务由既有实例继续提供）。 */
		preferred := effectivePort(*port, a)
		_, werr := openWindow(context.Background(), windowURL(effectiveBind(*bind, a), preferred))
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

/* windowURL 组装窗口地址；回环地址统一用 127.0.0.1（localhost 可能解析到 ::1）。 */
func windowURL(bind string, port int) string {
	if bind == "" || bind == "localhost" || bind == "::1" {
		bind = "127.0.0.1"
	}
	return fmt.Sprintf("http://%s/", net.JoinHostPort(bind, strconv.Itoa(port)))
}
