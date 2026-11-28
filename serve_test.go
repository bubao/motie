package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"testing"
)

/* 单实例区间探测（FindRunning / AlreadyRunningError）的行为锁定。
 * 背景：首实例可能因默认端口被占而顺延运行；只探测首选端口会漏掉它，
 * 导致新进程另起服务、破坏单实例语义，且无法为既有实例打开窗口。 */

// serveBodyAt 在指定端口起临时 HTTP 服务返回固定 JSON 体，返回清理函数。
func serveBodyAt(t *testing.T, port int, body string) func() {
	t.Helper()
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatalf("listen %d: %v", port, err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, body)
	})}
	go func() { _ = srv.Serve(ln) }()
	return func() { _ = srv.Close() }
}

// serveBody 在随机端口起临时 HTTP 服务返回固定 JSON 体，返回端口与清理函数。
func serveBody(t *testing.T, body string) (int, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, body)
	})}
	go func() { _ = srv.Serve(ln) }()
	return ln.Addr().(*net.TCPAddr).Port, func() { _ = srv.Close() }
}

/* freeAdjacentPorts 找一对相邻可用端口 P / P+1（短暂探测后释放，测试环境可接受竞态）。 */
func freeAdjacentPorts(t *testing.T) int {
	t.Helper()
	for i := 0; i < 100; i++ {
		p, err := freePort()
		if err != nil {
			t.Fatalf("freePort: %v", err)
		}
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p+1))
		if err != nil {
			continue
		}
		_ = ln.Close()
		return p
	}
	t.Fatal("找不到相邻可用端口")
	return 0
}

func freePort() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer func() { _ = ln.Close() }()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

func TestFindRunningHitsPreferredPort(t *testing.T) {
	p, cleanup := serveBody(t, `{"app":"motie"}`)
	defer cleanup()

	got, ok, err := FindRunning("127.0.0.1", p)
	if err != nil {
		t.Fatalf("FindRunning 出错：%v", err)
	}
	if !ok || got != p {
		t.Fatalf("期望命中首选端口 %d，实际 ok=%v port=%d", p, ok, got)
	}
}

func TestFindRunningScansShiftedPort(t *testing.T) {
	base := freeAdjacentPorts(t)
	// base 被非 motie 服务占用；base+1 是已顺延运行的 motie 实例
	defer serveBodyAt(t, base, `{"app":"other"}`)()
	defer serveBodyAt(t, base+1, `{"app":"motie"}`)()

	got, ok, err := FindRunning("127.0.0.1", base)
	if err != nil {
		t.Fatalf("FindRunning 出错：%v", err)
	}
	if !ok || got != base+1 {
		t.Fatalf("期望扫描到顺延端口 %d，实际 ok=%v port=%d", base+1, ok, got)
	}
}

func TestFindRunningIgnoresNonMotie(t *testing.T) {
	p, cleanup := serveBody(t, `{"app":"other"}`)
	defer cleanup()

	_, ok, err := FindRunning("127.0.0.1", p)
	if err != nil {
		t.Fatalf("FindRunning 出错：%v", err)
	}
	if ok {
		t.Fatal("非 motie 服务不应被判为已运行实例")
	}
}

func TestAlreadyRunningErrorCarriesPort(t *testing.T) {
	err := error(&AlreadyRunningError{Port: 39131})
	if !errors.Is(err, ErrAlreadyRunning) {
		t.Fatal("AlreadyRunningError 应匹配哨兵 ErrAlreadyRunning")
	}
	var target *AlreadyRunningError
	if !errors.As(err, &target) || target.Port != 39131 {
		t.Fatalf("errors.As 未取到端口，target=%+v", target)
	}
}

/* serveBodyOnHost 在指定监听地址（如 0.0.0.0）起临时 motie 伪装服务。 */
func serveBodyOnHost(t *testing.T, host string, port int, body string) func() {
	t.Helper()
	ln, err := net.Listen("tcp", fmt.Sprintf("%s:%d", host, port))
	if err != nil {
		t.Fatalf("listen %s:%d: %v", host, port, err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, body)
	})}
	go func() { _ = srv.Serve(ln) }()
	return func() { _ = srv.Close() }
}

func TestClientHostMapsWildcardAndKeepsIPv6(t *testing.T) {
	cases := map[string]string{
		"":            "127.0.0.1",
		"localhost":   "127.0.0.1",
		"0.0.0.0":     "127.0.0.1",
		"::":          "::1",
		"::1":         "::1",
		"[::1]":       "::1",
		"127.0.0.1":   "127.0.0.1",
		"192.168.1.5": "192.168.1.5",
	}
	for in, want := range cases {
		if got := clientHost(in); got != want {
			t.Fatalf("clientHost(%q) = %q，期望 %q", in, got, want)
		}
	}
}

func TestWindowURLUsesClientHost(t *testing.T) {
	if got := windowURL("0.0.0.0", 39130); got != "http://127.0.0.1:39130/" {
		t.Fatalf("通配监听窗口地址错误：%q", got)
	}
	if got := windowURL("[::1]", 39130); got != "http://[::1]:39130/" {
		t.Fatalf("纯 IPv6 回环窗口地址被错误改写：%q", got)
	}
	if got := windowURL("192.168.1.5", 39130); got != "http://192.168.1.5:39130/" {
		t.Fatalf("具体地址不应被改写：%q", got)
	}
}

/* 通配监听（0.0.0.0）时探测必须走客户端可直连的回环地址。 */
func TestDetectRunningAcceptsWildcardBind(t *testing.T) {
	base := freeAdjacentPorts(t)
	defer serveBodyOnHost(t, "0.0.0.0", base, `{"app":"motie"}`)()

	ok, err := DetectRunning("0.0.0.0", base)
	if err != nil {
		t.Fatalf("DetectRunning 出错：%v", err)
	}
	if !ok {
		t.Fatal("0.0.0.0 监听的 motie 服务应被探测命中")
	}
}
