package api

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

/*
写操作同源守卫的防漂移测试（对应 desktop-architecture §12 风险项）：
新增 / 改名写路由时必须经过 sameOrigin 中间件。实现方式是从源码解析全部
`s.mux.HandleFunc("METHOD /path", ...)` 注册，对每条非 GET/HEAD 路由发起跨域请求，
断言 403；再带本机 Origin 断言放行（非 403）。这样「漏挂中间件」会立即失败。
*/

// parseRegisteredRoutes 从 api.go 源码解析路由注册字面量，返回 "METHOD /path" 列表。
func parseRegisteredRoutes(t *testing.T) []string {
	t.Helper()
	f, err := os.Open("api.go")
	if err != nil {
		t.Fatalf("读取 api.go：%v", err)
	}
	defer f.Close()
	src, err := io.ReadAll(f)
	if err != nil {
		t.Fatalf("读取 api.go 内容：%v", err)
	}
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "api.go", src, 0)
	if err != nil {
		t.Fatalf("解析 api.go：%v", err)
	}
	var out []string
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok || len(call.Args) < 1 {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "HandleFunc" {
			return true
		}
		lit, ok := call.Args[0].(*ast.BasicLit)
		if !ok || lit.Kind != token.STRING {
			return true
		}
		out = append(out, strings.Trim(lit.Value, "`\""))
		return true
	})
	if len(out) == 0 {
		t.Fatal("未解析到任何路由注册（解析逻辑可能已过时）")
	}
	return out
}

func isWriteMethod(m string) bool {
	switch m {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

func concretePath(p string) string {
	// 路径模板占位符替换为合法值，避免因 404 掩盖「是否被守卫」的判断
	if i := strings.IndexByte(p, '{'); i >= 0 {
		if j := strings.IndexByte(p[i:], '}'); j >= 0 {
			p = p[:i] + "1" + p[i+j+1:]
		}
	}
	return p
}

/* 所有写路由必须拒绝跨域来源；本机 Origin 必须放行（不返回 403）。 */
func TestAllWriteRoutesGuardedByOrigin(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()

	var writes int
	for _, route := range parseRegisteredRoutes(t) {
		parts := strings.SplitN(route, " ", 2)
		if len(parts) != 2 || !isWriteMethod(parts[0]) {
			continue
		}
		path := concretePath(parts[1])
		writes++

		rec := do(t, h, parts[0], path, "http://evil.example.com", nil)
		if rec.Code != http.StatusForbidden {
			t.Errorf("写路由 %s %s 跨域应 403，实际 %d（疑似漏挂 sameOrigin）", parts[0], path, rec.Code)
		}

		rec = do(t, h, parts[0], path, "http://127.0.0.1:39130", nil)
		if rec.Code == http.StatusForbidden {
			t.Errorf("写路由 %s %s 本机 Origin 被误拦（403）", parts[0], path)
		}
	}
	if writes == 0 {
		t.Fatal("未找到任何写路由（解析或筛选逻辑异常）")
	}
	t.Logf("已校验写路由 %d 条", writes)
}

/* 读路由不应被同源守卫拦截（含跨域），保证公开页面可读。 */
func TestReadRoutesNotBlockedByOrigin(t *testing.T) {
	s, _ := testServer(t)
	h := s.Handler()

	for _, route := range parseRegisteredRoutes(t) {
		parts := strings.SplitN(route, " ", 2)
		if len(parts) != 2 || isWriteMethod(parts[0]) || parts[0] == http.MethodHead {
			continue
		}
		path := concretePath(parts[1])
		if path == "/api/events" {
			continue /* SSE 长连接，请求不会自行返回，单独由事件总线测试覆盖 */
		}
		rec := do(t, h, parts[0], path, "http://evil.example.com", nil)
		if rec.Code == http.StatusForbidden {
			t.Errorf("读路由 %s %s 不应因跨域 403，实际 %d", parts[0], path, rec.Code)
		}
	}
}

/* 兜底与静态路由存在性：未知 /api/* 必须 404 JSON，不得降级成 index.html（契约伪装）。 */
func TestUnknownAPIRouteIsJSON404(t *testing.T) {
	s, _ := testServer(t)
	rec := httptest.NewRequest(http.MethodGet, "/api/definitely-not-a-route", nil)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, rec)
	if w.Code != http.StatusNotFound {
		t.Fatalf("未知 API 路由应 404，实际 %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Errorf("未知 API 路由应返回 JSON，实际 Content-Type=%q", ct)
	}
}
