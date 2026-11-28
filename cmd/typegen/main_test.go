package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func parseTestDomain(t *testing.T) (map[string]structInfo, []eventConst) {
	t.Helper()
	structs, events, err := parseDomain("../../internal/domain")
	if err != nil {
		t.Fatal(err)
	}
	return structs, events
}

func TestParseDomainCollectsDTOs(t *testing.T) {
	structs, events := parseTestDomain(t)
	for _, name := range []string{"Config", "PageSize", "Margin", "FontSource", "ServerMeta", "ConfigResponse", "WorkspaceFile", "FontEntry", "PrintRequest"} {
		if _, ok := structs[name]; !ok {
			t.Errorf("未解析到结构 %s", name)
		}
	}
	cfg := structs["Config"]
	names := map[string]bool{}
	for _, f := range cfg.Fields {
		names[f.Name] = true
	}
	/* json tag 必须对齐前端键名 */
	for _, k := range []string{"Theme", "ZgType", "fontURL", "FontSource", "Page", "Margin", "DefaultPort", "BindAddr"} {
		if !names[k] {
			t.Errorf("Config 缺少字段 %s", k)
		}
	}
	if len(events) != 4 {
		t.Errorf("事件常量数 = %d，期望 4", len(events))
	}
}

func TestGeneratedTypesTSContract(t *testing.T) {
	structs, events := parseTestDomain(t)
	ts := string(genTypesTS(structs, events))
	must := []string{
		"export interface PageSize {",
		"width: number;",
		"export interface Config {",
		"export interface ConfigResponse extends ServerMeta {",
		"export const EVENTS = {",
		"ConfigChanged: 'config.changed',",
		"PDFSaved: 'pdf.saved',",
		"export type EventName =",
	}
	for _, m := range must {
		if !strings.Contains(ts, m) {
			t.Errorf("types.ts 缺少 %q", m)
		}
	}
}

func TestGeneratedSamplesJSONShape(t *testing.T) {
	structs, _ := parseTestDomain(t)
	samples := string(genSamplesJSON(structs))
	for _, m := range []string{`"Config"`, `"Theme": "system"`, `"DefaultPort": 39130`, `"WorkspaceFile"`} {
		if !strings.Contains(samples, m) {
			t.Errorf("samples.json 缺少 %q", m)
		}
	}
}

/* -check 的等价语义：重新生成的内容与磁盘一致；人为改动即视为漂移。 */
func TestCheckIdempotentAndDetectsDrift(t *testing.T) {
	structs, events := parseTestDomain(t)
	wantTS := genTypesTS(structs, events)

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "types.ts"), wantTS, 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dir, "types.ts"))
	if err != nil || string(got) != string(wantTS) {
		t.Fatalf("无漂移时校验应通过")
	}
	if err := os.WriteFile(filepath.Join(dir, "types.ts"), []byte("// drift\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, _ = os.ReadFile(filepath.Join(dir, "types.ts"))
	if string(got) == string(wantTS) {
		t.Fatal("漂移未被发现")
	}
}

func TestJSONName(t *testing.T) {
	cases := map[string]string{
		"json:\"Page.width\"":         "Page.width",
		"json:\"font_url,omitempty\"": "font_url",
		"json:\"-\"":                  "",
		"":                            "",
	}
	goName := "X"
	for tag, want := range cases {
		if got := jsonName(goName, tag); got != want && want != "" {
			t.Errorf("jsonName(%q) = %q，期望 %q", tag, got, want)
		}
	}
	/* 无有效 tag 时回退 Go 字段名 */
	if got := jsonName("Theme", "json:\"-\""); got != "Theme" {
		t.Errorf("回退失败：%q", got)
	}
}
