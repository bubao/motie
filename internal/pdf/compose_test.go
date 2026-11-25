package pdf

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// testJPEG 生成一张 w×h 的纯色 baseline JPEG（canvas toBlob('image/jpeg') 同类产物）。
func testJPEG(t *testing.T, w, h int, c color.Color) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 92}); err != nil {
		t.Fatalf("jpeg.Encode: %v", err)
	}
	return buf.Bytes()
}

func TestComposePDFA4TwoPages(t *testing.T) {
	p1 := testJPEG(t, 1240, 1754, color.RGBA{R: 255, A: 255})
	p2 := testJPEG(t, 1240, 1754, color.RGBA{B: 255, A: 255})
	out, err := ComposePDF([][]byte{p1, p2}, 210, 297)
	if err != nil {
		t.Fatalf("ComposePDF: %v", err)
	}
	if !bytes.HasPrefix(out, []byte("%PDF-")) {
		t.Fatalf("缺少 %%PDF 头")
	}
	if !bytes.HasSuffix(bytes.TrimRight(out, "\n"), []byte("%%EOF")) {
		t.Fatalf("缺少 %%EOF 尾")
	}
	if n := strings.Count(string(out), "/Type /Page "); n != 2 { // 不含 Pages
		t.Fatalf("页数 = %d，期望 2", n)
	}
	if !strings.Contains(string(out), "/Count 2") {
		t.Fatalf("缺少 /Count 2")
	}
	// A4 → pt：595.276 × 841.890
	if !strings.Contains(string(out), "/MediaBox [0 0 595.276 841.890]") {
		t.Fatalf("MediaBox 换算错误")
	}
	// startxref 指向 xref 表
	s := string(out)
	i := strings.LastIndex(s, "startxref\n")
	if i < 0 {
		t.Fatalf("缺少 startxref")
	}
	line, _, _ := strings.Cut(s[i+len("startxref\n"):], "\n")
	off, err := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || off >= len(out) || !bytes.HasPrefix(out[off:], []byte("xref\n")) {
		t.Fatalf("startxref 偏移非法：%d", off)
	}
	// xref 条目与实际对象偏移一致（对象 1..2+3N）
	objRe := regexp.MustCompile(`(?m)^(\d+) 0 obj\n`)
	locs := objRe.FindAllStringSubmatchIndex(s, -1)
	if len(locs) != 2+3*2 {
		t.Fatalf("对象数 = %d，期望 %d", len(locs), 2+3*2)
	}
	for _, m := range locs {
		num, _ := strconv.Atoi(s[m[2]:m[3]])
		if num < 1 || num > len(locs) {
			t.Fatalf("对象号越界 %d", num)
		}
		want := fmt.Sprintf("%010d 00000 n", m[0])
		if !strings.Contains(s, want) {
			t.Fatalf("对象 %d 的 xref 偏移缺失或不一致", num)
		}
	}
	// 每页图像流逐字节等于输入（按出现顺序消费）
	from := 0
	for idx, src := range [][]byte{p1, p2} {
		needle := fmt.Sprintf("/Filter /DCTDecode /Length %d >>\nstream\n", len(src))
		rel := strings.Index(s[from:], needle)
		if rel < 0 {
			t.Fatalf("第 %d 页图像头缺失", idx+1)
		}
		at := from + rel
		from = at + len(needle) + len(src)
		begin := at + len(needle)
		if !bytes.Equal(out[begin:begin+len(src)], src) {
			t.Fatalf("第 %d 页图像字节不一致", idx+1)
		}
	}
}

func TestComposePDFErrors(t *testing.T) {
	valid := testJPEG(t, 8, 8, color.White)
	cases := []struct {
		name       string
		pages      [][]byte
		w, h       float64
		wantErrHas string
	}{
		{"空页面", nil, 210, 297, "没有可导出"},
		{"非法纸张", [][]byte{valid}, 0, 297, "纸张尺寸非法"},
		{"非 JPEG", [][]byte{[]byte("%PDF-1.4 not jpeg")}, 210, 297, "不是 JPEG"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ComposePDF(tc.pages, tc.w, tc.h)
			if err == nil || !strings.Contains(err.Error(), tc.wantErrHas) {
				t.Fatalf("err = %v，期望包含 %q", err, tc.wantErrHas)
			}
		})
	}
}

// 手工构造一个带 SOF2（渐进式）marker 的 JPEG 头，验证拒绝路径。
func TestScanJPEGRejectsProgressive(t *testing.T) {
	head := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 'J', 'F', 'I', 'F',
		0xFF, 0xC2, 0x00, 0x0B, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0x01, 0x11, 0x00}
	if _, _, _, err := scanJPEG(head); err == nil || !strings.Contains(err.Error(), "渐进式") {
		t.Fatalf("渐进式未拒绝：%v", err)
	}
	if _, _, _, err := scanJPEG([]byte("nope")); err == nil || !strings.Contains(err.Error(), "不是 JPEG") {
		t.Fatalf("非 JPEG 未拒绝：%v", err)
	}
}
