// scripts/gen-assets.go — 纯代码生成 motie 品牌资产（仓库不提交任何二进制媒体文件）。
//
// 产物（build/）：
//   - appicon.png   1024x1024 图标母版：宣纸底 + 朱砂外框 + 方胜双田（供 Linux hicolor / macOS iconset 切图）
//   - app.ico       Windows 多尺寸复合图标（16/32/48/64/128/256，Vista+ 兼容的 PNG 压缩条目）
//   - app.manifest  Windows DPI 感知 / 长路径 / 兼容清单（由 gen-windows-resources.sh 经 rsrc 编译进 PE）
//
// 用法：go run ./scripts/gen-assets.go [root]（默认当前目录）
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
)

/* ---------- Windows 应用清单 ---------- */

const manifestContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!--
  motie Windows 应用清单：声明 DPI 感知、长路径支持与 Win10/11 兼容标识。
  由 scripts/gen-windows-resources.sh 通过 rsrc 编译进 PE 资源。
-->
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity
    type="win32"
    name="Motie"
    version="0.0.0.0"
    processorArchitecture="amd64"
  />
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
      <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>
    </windowsSettings>
  </application>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <!-- Windows 10 / 11 -->
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" />
      <!-- Windows 8.1 -->
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}" />
      <!-- Windows 8 -->
      <supportedOS Id="{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}" />
      <!-- Windows 7 -->
      <supportedOS Id="{35138b9a-5d96-4fbd-8e2d-a2440225f93a}" />
    </application>
  </compatibility>
</assembly>
`

/* ---------- 主流程 ---------- */

func main() {
	root := "."
	if len(os.Args) > 1 {
		root = os.Args[1]
	}
	dir := filepath.Join(root, "build")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		fail("创建 build 目录失败: %v", err)
	}

	writeFileIfChanged(filepath.Join(dir, "app.manifest"), []byte(manifestContent))

	icon := drawAppIcon()
	writeFileIfChanged(filepath.Join(dir, "appicon.png"), encodePNG(icon))
	writeFileIfChanged(filepath.Join(dir, "app.ico"), encodeICO(icon, []int{16, 32, 48, 64, 128, 256}))

	fmt.Printf("[gen-assets] 品牌资产已生成 -> %s (appicon.png, app.ico, app.manifest)\n", dir)
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "[gen-assets] "+format+"\n", args...)
	os.Exit(1)
}

/* writeFileIfChanged 内容未变化时不重写，保持产物时间戳稳定。 */
func writeFileIfChanged(path string, data []byte) {
	if existing, err := os.ReadFile(path); err == nil && bytes.Equal(existing, data) {
		return
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		fail("写入 %s 失败: %v", path, err)
	}
}

func encodePNG(img image.Image) []byte {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		fail("PNG 编码失败: %v", err)
	}
	return buf.Bytes()
}

/* ---------- 图标绘制：宣纸底 + 朱砂外框 + 方胜双田（描红格） ---------- */

var (
	paper    = color.RGBA{0xF7, 0xF2, 0xE6, 0xFF} // 宣纸米白（底色）
	inkColor = color.RGBA{0x2E, 0x2B, 0x26, 0xFF} // 墨色（格线）
	cinnabar = color.RGBA{0xC8, 0x40, 0x2A, 0xFF} // 朱砂红（外框）
)

const iconSize = 1024

/* drawAppIcon 绘制 1024x1024 图标：圆角宣纸底 + 朱砂外框 +
 * 错半格相叠的双田字格（方胜纹，十字虚线取描红格惯例）。 */
func drawAppIcon() *image.RGBA {
	img := paperBaseOf(paper)
	roundedRectOutline(img, 100, 12, 176, 1, cinnabar) // 朱砂外框
	const w = 8.5
	drawTianCell(img, 427, 427, 170, w, 0.86, 22, inkColor) // 左上
	drawTianCell(img, 597, 597, 170, w, 0.86, 22, inkColor) // 右下
	return img
}

/* paperBaseOf 画指定底色的圆角方块，返回画布（边缘仅 alpha 渐隐）。 */
func paperBaseOf(base color.RGBA) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, iconSize, iconSize))
	const radius = 176.0
	for y := 0; y < iconSize; y++ {
		for x := 0; x < iconSize; x++ {
			d := roundedRectSDF(float64(x)+0.5, float64(y)+0.5, iconSize, iconSize, radius)
			switch {
			case d <= 0:
				setPixel(img, x, y, base)
			default:
				cov := clamp(1-d, 0, 1)
				setPixel(img, x, y, color.RGBA{base.R, base.G, base.B, uint8(math.Round(cov * 255))})
			}
		}
	}
	return img
}

/* roundedRectOutline 圆角矩形环描边：SDF 环带一次算覆盖率。
 * outer 为环带外缘距画布外轮廓的距离，w 为带宽。 */
func roundedRectOutline(img *image.RGBA, outer, w, radius, alpha float64, c color.RGBA) {
	lo := int(math.Floor(outer - 2))
	hi := int(math.Ceil(float64(iconSize) - outer + 2))
	for y := lo; y <= hi && y < iconSize; y++ {
		if y < 0 {
			continue
		}
		for x := lo; x <= hi && x < iconSize; x++ {
			if x < 0 {
				continue
			}
			sd := -roundedRectSDF(float64(x)+0.5, float64(y)+0.5, iconSize, iconSize, radius) // 形内深度
			if sd < outer-1 || sd > outer+w+1 {
				continue
			}
			cov := clamp(math.Min(sd-outer, outer+w-sd)+0.5, 0, 1)
			if cov > 0 {
				blendOver(img, x, y, c, cov*alpha)
			}
		}
	}
}

/* distSeg 点到线段距离。 */
func distSeg(px, py, x0, y0, x1, y1 float64) float64 {
	dx, dy := x1-x0, y1-y0
	l2 := dx*dx + dy*dy
	t := 0.0
	if l2 > 0 {
		t = clamp(((px-x0)*dx+(py-y0)*dy)/l2, 0, 1)
	}
	return math.Hypot(px-(x0+dx*t), py-(y0+dy*t))
}

/* strokeSegSDF 线段描边：点到线段距离一次算覆盖率，无重复叠色。 */
func strokeSegSDF(img *image.RGBA, x0, y0, x1, y1, w, alpha float64, c color.RGBA) {
	mx := math.Max(math.Abs(x1-x0), math.Abs(y1-y0)) + w + 3
	cx, cy := (x0+x1)/2, (y0+y1)/2
	lo := int(cx - mx)
	hi := int(cx + mx)
	bot := int(cy - mx)
	top := int(cy + mx)
	b := img.Bounds()
	for y := bot; y <= top; y++ {
		if y < b.Min.Y || y >= b.Max.Y {
			continue
		}
		for x := lo; x <= hi; x++ {
			if x < b.Min.X || x >= b.Max.X {
				continue
			}
			d := distSeg(float64(x)+0.5, float64(y)+0.5, x0, y0, x1, y1)
			cov := clamp(w/2+0.5-d, 0, 1)
			if cov > 0 {
				blendOver(img, x, y, c, cov*alpha)
			}
		}
	}
}

/* strokeDashSDF 虚线段：按弧长分 dash/gap，逐段走 SDF 描边。 */
func strokeDashSDF(img *image.RGBA, x0, y0, x1, y1, dash, gap, w, alpha float64, c color.RGBA) {
	l := math.Hypot(x1-x0, y1-y0)
	if l == 0 {
		return
	}
	for s0 := 0.0; s0 < l; s0 += dash + gap {
		s1 := math.Min(s0+dash, l)
		strokeSegSDF(img, x0+(x1-x0)*s0/l, y0+(y1-y0)*s0/l,
			x0+(x1-x0)*s1/l, y0+(y1-y0)*s1/l, w, alpha, c)
	}
}

/* drawTianCell 一个正向「田字格」：正方形外框 + 十字中线（dash>0 则十字为虚线）。 */
func drawTianCell(img *image.RGBA, cx, cy, half, w, alpha float64, dash float64, c color.RGBA) {
	x0, y0 := cx-half, cy-half
	x1, y1 := cx+half, cy+half
	strokeSegSDF(img, x0, y0, x1, y0, w, alpha, c)
	strokeSegSDF(img, x1, y0, x1, y1, w, alpha, c)
	strokeSegSDF(img, x1, y1, x0, y1, w, alpha, c)
	strokeSegSDF(img, x0, y1, x0, y0, w, alpha, c)
	if dash > 0 {
		strokeDashSDF(img, x0, cy, x1, cy, dash, dash*0.75, w*0.8, alpha*0.85, c)
		strokeDashSDF(img, cx, y0, cx, y1, dash, dash*0.75, w*0.8, alpha*0.85, c)
	} else {
		strokeSegSDF(img, x0, cy, x1, cy, w, alpha, c) // 横中线
		strokeSegSDF(img, cx, y0, cx, y1, w, alpha, c) // 纵中线
	}
}

func roundedRectSDF(px, py, w, h, r float64) float64 {
	qx := math.Abs(px-w/2) - (w/2 - r)
	qy := math.Abs(py-h/2) - (h/2 - r)
	ax := math.Max(qx, 0)
	ay := math.Max(qy, 0)
	outside := math.Hypot(ax, ay)
	inside := math.Min(math.Max(qx, qy), 0)
	return outside + inside - r
}

func setPixel(img *image.RGBA, x, y int, c color.RGBA) {
	i := img.PixOffset(x, y)
	img.Pix[i] = c.R
	img.Pix[i+1] = c.G
	img.Pix[i+2] = c.B
	img.Pix[i+3] = c.A
}

/* setPixelBlend 把颜色 c 以权重 w 叠加到 base 上（等价于 alpha 混合，base 为当前像素色）。 */
func setPixelBlend(img *image.RGBA, x, y int, base, c color.RGBA, w float64) {
	i := img.PixOffset(x, y)
	blend := func(b, s uint8) uint8 {
		return uint8(math.Round(float64(b)*(1-w) + float64(s)*w))
	}
	img.Pix[i] = blend(base.R, c.R)
	img.Pix[i+1] = blend(base.G, c.G)
	img.Pix[i+2] = blend(base.B, c.B)
	img.Pix[i+3] = blend(base.A, c.A)
}

/* blendOver 把颜色 c 以权重 a src-over 到当前像素（底色取像素现有色）。 */
func blendOver(img *image.RGBA, x, y int, c color.RGBA, a float64) {
	i := img.PixOffset(x, y)
	setPixelBlend(img, x, y,
		color.RGBA{img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3]}, c, a)
}

/* ---------- ICO 编码（Vista+ 兼容：PNG 压缩条目） ---------- */

/* encodeICO 把同一图缩放为多尺寸并封装为标准 .ico。 */
func encodeICO(src image.Image, sizes []int) []byte {
	images := make([][]byte, len(sizes))
	for i, s := range sizes {
		images[i] = encodePNG(areaAverageScale(src, s, s))
	}

	var buf bytes.Buffer
	var hdr [6]byte
	binary.LittleEndian.PutUint16(hdr[2:], 1) // ICON type
	binary.LittleEndian.PutUint16(hdr[4:], uint16(len(sizes)))
	buf.Write(hdr[:])

	offset := 6 + 16*len(sizes)
	for i, s := range sizes {
		dim := uint8(0) // 256 用 0 表示
		if s < 256 {
			dim = uint8(s)
		}
		var e [16]byte
		e[0] = dim
		e[1] = dim
		binary.LittleEndian.PutUint16(e[4:], 1)  // planes
		binary.LittleEndian.PutUint16(e[6:], 32) // bpp
		binary.LittleEndian.PutUint32(e[8:], uint32(len(images[i])))
		binary.LittleEndian.PutUint32(e[12:], uint32(offset))
		buf.Write(e[:])
		offset += len(images[i])
	}
	for _, data := range images {
		buf.Write(data)
	}
	return buf.Bytes()
}

/* areaAverageScale 盒式加权平均缩放（缩小时抗锯齿的自然做法）。 */
func areaAverageScale(src image.Image, dw, dh int) image.Image {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	xRatio := float64(sw) / float64(dw)
	yRatio := float64(sh) / float64(dh)
	for dy := 0; dy < dh; dy++ {
		sy0 := float64(dy) * yRatio
		sy1 := float64(dy+1) * yRatio
		for dx := 0; dx < dw; dx++ {
			sx0 := float64(dx) * xRatio
			sx1 := float64(dx+1) * xRatio
			dst.Set(dx, dy, avgArea(src, sx0, sy0, sx1, sy1))
		}
	}
	return dst
}

/* avgArea 计算源区域 [sx0,sx1)x[sy0,sy1) 的预乘 alpha 面积加权平均色。 */
func avgArea(src image.Image, sx0, sy0, sx1, sy1 float64) color.RGBA {
	var r, g, bl, a, wsum float64
	x0 := int(math.Floor(sx0))
	x1 := int(math.Ceil(sx1))
	y0 := int(math.Floor(sy0))
	y1 := int(math.Ceil(sy1))
	for y := y0; y < y1; y++ {
		wy := math.Min(float64(y+1), sy1) - math.Max(float64(y), sy0)
		if wy <= 0 {
			continue
		}
		for x := x0; x < x1; x++ {
			wx := math.Min(float64(x+1), sx1) - math.Max(float64(x), sx0)
			if wx <= 0 {
				continue
			}
			w := wx * wy
			sr, sg, sb, sa := src.At(x, y).RGBA() // 0..65535
			a += float64(sa) / 65535 * w
			if sa > 0 { // 预乘平均，避免透明区染色
				r += float64(sr) / 65535 * w
				g += float64(sg) / 65535 * w
				bl += float64(sb) / 65535 * w
			}
			wsum += w
		}
	}
	if wsum == 0 {
		return color.RGBA{}
	}
	af := a / wsum
	if af == 0 {
		return color.RGBA{}
	}
	return color.RGBA{
		R: uint8(math.Round(r / a)),
		G: uint8(math.Round(g / a)),
		B: uint8(math.Round(bl / a)),
		A: uint8(math.Round(af * 255)),
	}
}

/* clamp 限定 v 到 [lo, hi]。 */
func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
