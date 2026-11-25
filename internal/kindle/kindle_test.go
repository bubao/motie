package kindle

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestExportWritesLite(t *testing.T) {
	dir := t.TempDir()
	svc := New(fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>lite</html>")}}, dir)
	got, err := svc.Export()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(dir, ExportFileName)
	if got != want {
		t.Errorf("返回 %q，期望 %q", got, want)
	}
	data, err := os.ReadFile(want)
	if err != nil || string(data) != "<html>lite</html>" {
		t.Fatalf("导出内容异常：%q, %v", data, err)
	}
	/* 覆盖导出 */
	if _, err := svc.Export(); err != nil {
		t.Fatalf("重复导出失败：%v", err)
	}
}

func TestExportUnavailable(t *testing.T) {
	svc := New(nil, t.TempDir())
	if _, err := svc.Export(); !errors.Is(err, ErrUnavailable) {
		t.Errorf("nil FS 应 ErrUnavailable，实际 %v", err)
	}
	svc2 := New(fstest.MapFS{}, t.TempDir())
	if _, err := svc2.Export(); !errors.Is(err, ErrUnavailable) {
		t.Errorf("缺 index.html 应 ErrUnavailable，实际 %v", err)
	}
	if _, err := New(fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("x")}}, "").Export(); err == nil {
		t.Error("未配置导出目录应报错")
	}
}
