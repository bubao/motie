package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.1.0", "0.0.9", 1},
		{"v0.2.0", "0.1.9", 1},
		{"1.0.0", "1.0.0", 0},
		{"0.0.1", "0.0.1", 0},
		{"2.0.0", "10.0.0", -1}, // 数值比较而非字典序
		{"1.0", "1.0.0", 0},
		{"1.0.1-beta", "1.0.1", 0}, // 非数字后缀忽略
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestUpdaterLatest(t *testing.T) {
	var calls atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/repos/bubao/motie/releases/latest" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"tag_name":     "v0.9.0",
			"html_url":     "https://github.com/bubao/motie/releases/tag/v0.9.0",
			"published_at": "2026-11-20T00:00:00Z",
		})
	}))
	defer srv.Close()

	u := NewUpdater("bubao/motie", "0.0.1")
	u.apiBase = srv.URL
	u.client = srv.Client()

	info, err := u.Latest(context.Background())
	if err != nil {
		t.Fatalf("Latest: %v", err)
	}
	if info.Current != "0.0.1" || info.Latest != "0.9.0" || !info.Newer {
		t.Errorf("unexpected info: %+v", info)
	}
	if info.URL == "" || info.PublishedAt == "" {
		t.Errorf("missing url/published_at: %+v", info)
	}

	// 缓存命中：10 分钟内不再请求
	if _, err := u.Latest(context.Background()); err != nil {
		t.Fatalf("cached Latest: %v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Errorf("calls = %d, want 1 (cache miss only)", got)
	}
}

func TestUpdaterLatestServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()

	u := NewUpdater("bubao/motie", "0.0.1")
	u.apiBase = srv.URL
	u.client = srv.Client()

	if _, err := u.Latest(context.Background()); err == nil {
		t.Fatal("expected error on 500")
	}
}

func TestUpdaterLatestNotFoundIsNotError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer srv.Close()

	u := NewUpdater("bubao/motie", "0.0.1")
	u.apiBase = srv.URL
	u.client = srv.Client()

	info, err := u.Latest(context.Background())
	if err != nil {
		t.Fatalf("404 should not be an error: %v", err)
	}
	if info.Newer || info.Latest != "" || info.Current != "0.0.1" {
		t.Errorf("unexpected info: %+v", info)
	}
}

func TestHandleUpdateLatestUnavailable(t *testing.T) {
	s := New(Deps{})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/update/latest", nil)
	s.mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rr.Code)
	}
}
