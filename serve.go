package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"time"

	"motie/internal/app"
)

/* Options：CLI 覆盖优先于配置文件的默认值。 */
type Options struct {
	Port int    // 0 = 配置 DefaultPort（39130）
	Bind string // 空 = 配置 BindAddr（127.0.0.1）
}

var ErrAlreadyRunning = errors.New("已有一个 motie 实例在运行")

const probeTimeout = 400 * time.Millisecond

/* DetectRunning 探测目标端口是否已是 motie 实例（GET /api/config 的 app == "motie"）。 */
func DetectRunning(bind string, port int) (bool, error) {
	url := fmt.Sprintf("http://%s/api/config", net.JoinHostPort(bind, strconv.Itoa(port)))
	client := &http.Client{Timeout: probeTimeout}
	resp, err := client.Get(url)
	if err != nil {
		return false, nil // 连接失败 = 无实例
	}
	defer resp.Body.Close()
	var meta struct {
		App string `json:"app"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&meta); err != nil {
		return false, nil
	}
	return meta.App == "motie", nil
}

/* ListenAvailable 从 preferred 起向后顺延（最多 10 个），返回可用 listener 与实际端口。 */
func ListenAvailable(bind string, preferred int) (net.Listener, int, error) {
	var lastErr error
	for p := preferred; p <= preferred+9; p++ {
		ln, err := net.Listen("tcp", net.JoinHostPort(bind, strconv.Itoa(p)))
		if err == nil {
			return ln, p, nil
		}
		lastErr = err
	}
	return nil, 0, fmt.Errorf("端口 %d-%d 均不可用：%w", preferred, preferred+9, lastErr)
}

/* Run 启动 HTTP 服务并在 ctx 取消（信号 / 窗口退出钩子）后统一收尾。
 * onReady 在监听就绪后调用（用于拉起窗口），传入实际端口。 */
func Run(ctx context.Context, a *app.App, opts Options, onReady func(port int)) error {
	cfg, err := a.Config.Get()
	if err != nil {
		return err
	}
	bind := opts.Bind
	if bind == "" {
		bind = cfg.BindAddr
	}
	if bind == "" {
		bind = "127.0.0.1"
	}
	if bind != "127.0.0.1" && bind != "::1" && bind != "localhost" {
		fmt.Printf("警告：监听地址 %s 非回环，服务将对本机网络可见\n", bind)
	}
	preferred := opts.Port
	if preferred == 0 {
		preferred = cfg.DefaultPort
	}

	running, err := DetectRunning(bind, preferred)
	if err != nil {
		return err
	}
	if running {
		return ErrAlreadyRunning
	}

	ln, port, err := ListenAvailable(bind, preferred)
	if err != nil {
		return err
	}
	a.Server.SetPort(port)
	fmt.Printf("motie v%s 已启动：http://%s\n", a.Version(), net.JoinHostPort(bind, strconv.Itoa(port)))

	httpSrv := &http.Server{
		Handler:           a.Server.Handler(),
		BaseContext:       func(net.Listener) context.Context { return a.Ctx() },
		ReadHeaderTimeout: 10 * time.Second,
	}

	serveErr := make(chan error, 1)
	go func() {
		if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
		close(serveErr)
	}()

	if onReady != nil {
		onReady(port)
	}

	select {
	case <-ctx.Done():
	case err := <-serveErr:
		if err != nil {
			return err
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	return a.Close()
}
