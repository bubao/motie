package pdf

import (
	"bytes"
	"fmt"
	"strconv"
)

/*
自写最小 PDF 组装器：把每页一张 baseline JPEG 拼成一份 PDF（JPEG 以 /DCTDecode
直通嵌入，不解码、不重编码）。相比前端 jsPDF：没有纯 JS 的图像解码路径，
桌面端导出不再产生长任务；零第三方依赖（go.mod 保持干净）。

PDF 结构（PDF 1.4）：
  1 Catalog → 2 Pages → 每页 3 个对象（Page / Contents / Image XObject）。
页面尺寸按 mm → pt（1mm = 72/25.4pt），图像整页铺满（cm 矩阵）。
*/

// mmToPt 毫米转磅（PDF 默认用户单位），保留 3 位小数以消除浮点尾差。
func mmToPt(mm float64) string {
	return strconv.FormatFloat(mm*72/25.4, 'f', 3, 64)
}

// IsJPEG 判断是否为 JPEG（SOI + 下一 marker，允许 Exif/JFIF 头）；上传侧早校验用。
func IsJPEG(data []byte) bool {
	return len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF
}

func isJPEG(data []byte) bool { return IsJPEG(data) }

/*
scanJPEG 解析 baseline JPEG 的 SOF，返回像素宽 / 高 / 颜色分量数。
渐进式（SOF2）与 CMYK（4 分量）直接报错：前端 canvas 只产出 baseline RGB / 灰度。
*/
func scanJPEG(data []byte) (w, h, comps int, err error) {
	if !isJPEG(data) {
		return 0, 0, 0, fmt.Errorf("页面图像不是 JPEG")
	}
	for i := 2; i+4 <= len(data); {
		if data[i] != 0xFF {
			i++
			continue
		}
		marker := data[i+1]
		if marker == 0xFF { // 连续填充字节
			i++
			continue
		}
		if marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7) {
			i += 2
			continue
		}
		if marker == 0xDA { // SOS：SOF 未出现
			break
		}
		if i+4 > len(data) {
			break
		}
		length := int(data[i+2])<<8 | int(data[i+3])
		if length < 2 || i+2+length > len(data) {
			break
		}
		switch marker {
		case 0xC0, 0xC1, 0xC2:
			sof := i + 4
			if sof+6 > len(data) {
				return 0, 0, 0, fmt.Errorf("JPEG SOF 段过短")
			}
			h = int(data[sof+1])<<8 | int(data[sof+2])
			w = int(data[sof+3])<<8 | int(data[sof+4])
			comps = int(data[sof+5])
			if marker == 0xC2 {
				return 0, 0, 0, fmt.Errorf("不支持渐进式 JPEG（progressive）")
			}
			if comps != 1 && comps != 3 {
				return 0, 0, 0, fmt.Errorf("不支持的 JPEG 颜色分量数 %d（仅支持灰度 / RGB）", comps)
			}
			if w <= 0 || h <= 0 {
				return 0, 0, 0, fmt.Errorf("JPEG 尺寸非法 %dx%d", w, h)
			}
			return w, h, comps, nil
		}
		i += 2 + length
	}
	return 0, 0, 0, fmt.Errorf("JPEG 缺少 SOF 段")
}

/*
ComposePDF 把 pages（每页一张 JPEG，按顺序）拼成一份 PDF；pageW / pageH 为纸张尺寸（mm）。
返回完整 PDF 字节，可直接落盘。
*/
func ComposePDF(pages [][]byte, pageW, pageH float64) ([]byte, error) {
	if len(pages) == 0 {
		return nil, fmt.Errorf("没有可导出的页面")
	}
	if pageW <= 0 || pageH <= 0 {
		return nil, fmt.Errorf("纸张尺寸非法 %.3f×%.3f mm", pageW, pageH)
	}
	type meta struct{ w, h, comps int }
	metas := make([]meta, len(pages))
	for i, p := range pages {
		w, h, comps, err := scanJPEG(p)
		if err != nil {
			return nil, fmt.Errorf("第 %d 页：%v", i+1, err)
		}
		metas[i] = meta{w: w, h: h, comps: comps}
	}

	var buf bytes.Buffer
	offsets := make([]int, 0, len(pages)*3+2) // 下标 +1 = 对象号
	startObj := func() {
		offsets = append(offsets, buf.Len())
		fmt.Fprintf(&buf, "%d 0 obj\n", len(offsets))
	}
	endObj := func() { buf.WriteString("\nendobj\n") }

	buf.WriteString("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n") // 二进制标记，避免编码器误判
	startObj()
	buf.WriteString("<< /Type /Catalog /Pages 2 0 R >>")
	endObj()
	kids := ""
	for i := range pages {
		if i > 0 {
			kids += " "
		}
		kids += strconv.Itoa(3+i*3) + " 0 R"
	}
	startObj()
	fmt.Fprintf(&buf, "<< /Type /Pages /Kids [%s] /Count %d >>", kids, len(pages))
	endObj()

	pageWpt, pageHpt := mmToPt(pageW), mmToPt(pageH)
	for i, p := range pages {
		pageObj := 3 + i*3
		contObj := pageObj + 1
		imgObj := pageObj + 2
		m := metas[i]
		colorSpace := "/DeviceRGB"
		if m.comps == 1 {
			colorSpace = "/DeviceGray"
		}
		startObj()
		fmt.Fprintf(&buf, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] "+
			"/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>",
			pageWpt, pageHpt, imgObj, contObj)
		endObj()
		content := fmt.Sprintf("q\n%s 0 0 %s 0 0 cm\n/Im0 Do\nQ\n", pageWpt, pageHpt)
		startObj()
		fmt.Fprintf(&buf, "<< /Length %d >>\nstream\n%s endstream", len(content), content)
		endObj()
		startObj()
		fmt.Fprintf(&buf, "<< /Type /XObject /Subtype /Image /Width %d /Height %d "+
			"/ColorSpace %s /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n",
			m.w, m.h, colorSpace, len(p))
		buf.Write(p)
		buf.WriteString("\nendstream")
		endObj()
	}

	xref := buf.Len()
	buf.WriteString("xref\n0 ")
	buf.WriteString(strconv.Itoa(len(offsets) + 1))
	buf.WriteString("\n0000000000 65535 f \n")
	for _, off := range offsets {
		fmt.Fprintf(&buf, "%010d 00000 n \n", off)
	}
	buf.WriteString("trailer\n<< /Size ")
	buf.WriteString(strconv.Itoa(len(offsets) + 1))
	buf.WriteString(" /Root 1 0 R >>\nstartxref\n")
	buf.WriteString(strconv.Itoa(xref))
	buf.WriteString("\n%%EOF\n")
	return buf.Bytes(), nil
}
