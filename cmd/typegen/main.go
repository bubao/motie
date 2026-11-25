// Command typegen 用 go/ast 解析 internal/domain 的 DTO 与事件常量，
// 生成 web/src/generated/types.ts（前后端共享契约）与 samples.json。
//
// 用法：
//
//	go run ./cmd/typegen           # 写入 generated 文件
//	go run ./cmd/typegen -check    # 只读校验漂移（CI / 验收用）
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"motie/internal/config"
)

var (
	checkOnly = flag.Bool("check", false, "只读校验已生成文件是否漂移")
	outDir    = flag.String("out", defaultOutDir(), "生成目录（web/src/generated）")
	domainSrc = flag.String("src", "internal/domain", "domain 包源码目录")
)

func defaultOutDir() string {
	wd, err := os.Getwd()
	if err != nil {
		return "web/src/generated"
	}
	return filepath.Join(wd, "web", "src", "generated")
}

/* ---------- ast 解析 ---------- */

type fieldInfo struct {
	Name string // TS 属性名（json tag 首段；无 tag 用 Go 字段名）
	Type string // Go 类型表达式（源码形态）
	Anon string // 匿名嵌入字段（如 ServerMeta）
}

type structInfo struct {
	Name   string
	Fields []fieldInfo
}

type eventConst struct {
	GoName string // EventConfigChanged
	Value  string // config.changed
}

func parseDomain(srcDir string) (map[string]structInfo, []eventConst, error) {
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, srcDir, nil, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("解析 %s：%w", srcDir, err)
	}
	structs := map[string]structInfo{}
	var events []eventConst

	for _, pkg := range pkgs {
		for _, file := range pkg.Files {
			ast.Inspect(file, func(n ast.Node) bool {
				switch x := n.(type) {
				case *ast.TypeSpec:
					st, ok := x.Type.(*ast.StructType)
					if !ok {
						return true
					}
					si := structInfo{Name: x.Name.Name}
					for _, f := range st.Fields.List {
						tag := ""
						if f.Tag != nil {
							tag = strings.Trim(f.Tag.Value, "`")
						}
						if len(f.Names) == 0 { // 匿名嵌入
							si.Fields = append(si.Fields, fieldInfo{Anon: exprString(f.Type)})
							continue
						}
						name := jsonName(f.Names[0].Name, tag)
						si.Fields = append(si.Fields, fieldInfo{Name: name, Type: exprString(f.Type)})
					}
					structs[si.Name] = si
				case *ast.ValueSpec:
					for i, v := range x.Values {
						lit, ok := v.(*ast.BasicLit)
						if !ok || lit.Kind != token.STRING || i >= len(x.Names) {
							continue
						}
						goName := x.Names[i].Name
						if !strings.HasPrefix(goName, "Event") {
							continue
						}
						events = append(events, eventConst{
							GoName: goName,
							Value:  strings.Trim(lit.Value, `"`),
						})
					}
				}
				return true
			})
		}
	}
	sort.Slice(events, func(i, j int) bool { return events[i].GoName < events[j].GoName })
	return structs, events, nil
}

/* jsonName 取 tag 中 json:"..." 的名字；缺省回退 Go 字段名。 */
func jsonName(goName, tag string) string {
	for _, part := range strings.FieldsFunc(tag, func(r rune) bool { return r == ' ' }) {
		if strings.HasPrefix(part, "json:") {
			v := strings.Trim(strings.TrimPrefix(part, "json:"), `"`)
			v = strings.Split(v, ",")[0]
			if v != "" && v != "-" {
				return v
			}
		}
	}
	return goName
}

func exprString(e ast.Expr) string {
	var b bytes.Buffer
	_ = formatNode(&b, e)
	return b.String()
}

func formatNode(b *bytes.Buffer, e ast.Expr) error {
	switch x := e.(type) {
	case *ast.Ident:
		b.WriteString(x.Name)
	case *ast.StarExpr:
		b.WriteByte('*')
		return formatNode(b, x.X)
	case *ast.SelectorExpr:
		if x.X != nil {
			if id, ok := x.X.(*ast.Ident); ok {
				b.WriteString(id.Name + ".")
			}
		}
		b.WriteString(x.Sel.Name)
	case *ast.ArrayType:
		if x.Len == nil {
			b.WriteString("[]")
		} else {
			fmt.Fprintf(b, "[%v]", x.Len)
		}
		return formatNode(b, x.Elt)
	case *ast.MapType:
		b.WriteString("map[")
		if err := formatNode(b, x.Key); err != nil {
			return err
		}
		b.WriteString("]")
		return formatNode(b, x.Value)
	default:
		return fmt.Errorf("不支持的类型表达式 %T", e)
	}
	return nil
}

/* ---------- TS 生成 ---------- */

var scalarTS = map[string]string{
	"string":  "string",
	"int":     "number",
	"float64": "number",
	"bool":    "boolean",
}

func tsType(goType string, structs map[string]structInfo) string {
	if t, ok := scalarTS[goType]; ok {
		return t
	}
	if strings.HasPrefix(goType, "*") {
		return tsType(strings.TrimPrefix(goType, "*"), structs)
	}
	if strings.HasPrefix(goType, "[]") {
		return tsType(strings.TrimPrefix(goType, "[]"), structs) + "[]"
	}
	if _, ok := structs[goType]; ok {
		return goType
	}
	return "unknown /* " + goType + " */"
}

/* emitInterface 生成单个 interface；匿名嵌入输出为 extends。 */
func emitInterface(sb *strings.Builder, si structInfo, structs map[string]structInfo) {
	var embeds []string
	for _, f := range si.Fields {
		if f.Anon != "" {
			embeds = append(embeds, f.Anon)
		}
	}
	fmt.Fprintf(sb, "export interface %s", si.Name)
	if len(embeds) > 0 {
		fmt.Fprintf(sb, " extends %s", strings.Join(embeds, ", "))
	}
	sb.WriteString(" {\n")
	for _, f := range si.Fields {
		if f.Anon != "" {
			continue
		}
		opt := ""
		fmt.Fprintf(sb, "\t%s%s: %s;\n", f.Name, opt, tsType(f.Type, structs))
	}
	sb.WriteString("}\n\n")
}

/* 生成顺序：被依赖的嵌套结构在前（PageSize/Margin/FontSource → Config → ConfigResponse）。 */
func genTypesTS(structs map[string]structInfo, events []eventConst) []byte {
	order := []string{"PageSize", "Margin", "FontSource", "Config", "ServerMeta", "WorkspaceFile", "FontEntry", "PDFExportRequest", "PrintRequest", "ConfigResponse"}
	var sb strings.Builder
	sb.WriteString("// 由 cmd/typegen 从 internal/domain 生成，请勿手改（修改 Go 结构后运行 go run ./cmd/typegen）。\n")
	sb.WriteString("// 契约镜像：zitie.config 键名（Page/Margin/FontSource 为嵌套对象）。\n\n")
	for _, name := range order {
		si, ok := structs[name]
		if !ok {
			continue
		}
		emitInterface(&sb, si, structs)
	}
	if len(events) > 0 {
		sb.WriteString("export const EVENTS = {\n")
		for _, e := range events {
			short := strings.TrimPrefix(e.GoName, "Event")
			fmt.Fprintf(&sb, "\t%s: '%s',\n", short, e.Value)
		}
		sb.WriteString("} as const;\n\n")
		sb.WriteString("export type EventName = typeof EVENTS[keyof typeof EVENTS];\n")
	}
	return []byte(sb.String())
}

/* ---------- JSON 样本 ---------- */

func sampleValue(name string, structs map[string]structInfo) any {
	if v, ok := sampleOverrides[name]; ok {
		return v
	}
	si, ok := structs[name]
	if !ok {
		return map[string]any{}
	}
	// 零值样本（由调用方决定是否替换）
	obj := map[string]any{}
	for _, f := range si.Fields {
		if f.Anon != "" {
			continue
		}
		obj[f.Name] = zeroOf(tsType(f.Type, structs))
	}
	return obj
}

func zeroOf(ts string) any {
	switch ts {
	case "string":
		return ""
	case "number":
		return 0
	case "boolean":
		return false
	default:
		if strings.HasSuffix(ts, "[]") {
			return []any{}
		}
		return map[string]any{}
	}
}

var sampleOverrides = map[string]any{
	"Config": config.DefaultConfig(),
}

func genSamplesJSON(structs map[string]structInfo) []byte {
	names := make([]string, 0, len(structs))
	for n := range structs {
		names = append(names, n)
	}
	sort.Strings(names)
	all := map[string]any{}
	for _, n := range names {
		all[n] = sampleValue(n, structs)
	}
	data, _ := json.MarshalIndent(all, "", "  ")
	return append(data, '\n')
}

/* ---------- 主流程 ---------- */

func main() {
	flag.Parse()
	structs, events, err := parseDomain(*domainSrc)
	if err != nil {
		fmt.Fprintln(os.Stderr, "typegen:", err)
		os.Exit(1)
	}
	typesTS := genTypesTS(structs, events)
	samples := genSamplesJSON(structs)

	if *checkOnly {
		drifted := false
		for name, want := range map[string][]byte{"types.ts": typesTS, "samples.json": samples} {
			got, err := os.ReadFile(filepath.Join(*outDir, name))
			if err != nil {
				fmt.Fprintf(os.Stderr, "typegen: -check 读取 %s 失败：%v\n", name, err)
				drifted = true
				continue
			}
			if !bytes.Equal(got, want) {
				fmt.Fprintf(os.Stderr, "typegen: %s 与 domain 漂移，请运行 go run ./cmd/typegen\n", name)
				drifted = true
			}
		}
		if drifted {
			os.Exit(1)
		}
		fmt.Println("typegen: -check 通过（types.ts / samples.json 无漂移）")
		return
	}

	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "typegen:", err)
		os.Exit(1)
	}
	for name, data := range map[string][]byte{"types.ts": typesTS, "samples.json": samples} {
		if err := os.WriteFile(filepath.Join(*outDir, name), data, 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "typegen: 写 %s：%v\n", name, err)
			os.Exit(1)
		}
	}
	fmt.Printf("typegen: 已生成 %s/types.ts 与 %s/samples.json\n", *outDir, *outDir)
}
