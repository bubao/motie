package pdf

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"image/color"
)

func TestSafeFilename(t *testing.T) {
	cases := []struct{ in, want string }{
		{"字帖", "字帖.pdf"},
		{"a/b.pdf", "b.pdf"}, // filepath.Base 取尾段
		{"a\\b:c*d?e\"f<g>h|i.pdf", "a_b_c_d_e_f_g_h_i.pdf"},
		{"..", ""},
		{"", ""},
		{".", ""},
	}
	for _, c := range cases {
		got, err := SafeFilename(c.in)
		if c.want == "" {
			if err == nil {
				t.Errorf("SafeFilename(%q) 应报错，得到 %q", c.in, got)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("SafeFilename(%q) = %q, err=%v，期望 %q", c.in, got, err, c.want)
		}
	}
}

func TestExportWritesFile(t *testing.T) {
	dir := t.TempDir()
	svc := New(dir)
	page := testJPEG(t, 1240, 1754, color.White)
	full, err := svc.Export("我的字帖", [][]byte{page}, 210, 297)
	if err != nil {
		t.Fatal(err)
	}
	if full != filepath.Join(dir, "我的字帖.pdf") {
		t.Errorf("路径 = %q", full)
	}
	data, err := os.ReadFile(full)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(data), "%PDF-") {
		t.Fatalf("落盘内容非 PDF：%q", data[:8])
	}
	if !strings.Contains(string(data), "/Count 1") {
		t.Errorf("页数标记缺失")
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Errorf("残留临时文件 %s", e.Name())
		}
	}
}

func TestExportRejectsBadInput(t *testing.T) {
	svc := New(t.TempDir())
	if _, err := svc.Export("x.pdf", [][]byte{[]byte("!!!not-jpeg")}, 210, 297); err == nil {
		t.Error("非 JPEG 页面应报错")
	}
	if _, err := svc.Export("../evil.pdf", [][]byte{testJPEG(t, 8, 8, color.White)}, 210, 297); err != nil {
		/* ../evil.pdf 经 Base 后为 evil.pdf，仍合法但限定在 exportDir */
		t.Logf("../ 文件名处理：%v", err)
	}
}

func TestExportPathTraversalContained(t *testing.T) {
	dir := t.TempDir()
	svc := New(dir)
	full, err := svc.Export("../../etc/evil.pdf", [][]byte{testJPEG(t, 8, 8, color.White)}, 210, 297)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(full) != dir {
		t.Errorf("穿越未被限制在 exportDir：%s", full)
	}
	if filepath.Base(full) != "evil.pdf" {
		t.Errorf("文件名 = %q", filepath.Base(full))
	}
}
