package domain

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestEventsAreKebabCaseAndUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, e := range Events {
		if e == "" {
			t.Fatalf("空事件名")
		}
		if strings.ToLower(e) != e || strings.ContainsAny(e, " _") {
			t.Errorf("事件名须为 kebab-case：%q", e)
		}
		if seen[e] {
			t.Errorf("事件名重复：%s", e)
		}
		seen[e] = true
	}
	want := []string{"config.changed", "file.saved", "font.added", "pdf.saved"}
	if len(Events) != len(want) {
		t.Fatalf("事件数量 = %d，期望 %d", len(Events), len(want))
	}
	for i := range want {
		if Events[i] != want[i] {
			t.Errorf("Events[%d] = %s，期望 %s", i, Events[i], want[i])
		}
	}
}

/* JSON 键必须与前端 zitie.config 完全一致（ipc 客户端无映射透传的前提） */
func TestConfigJSONKeysMatchFrontend(t *testing.T) {
	raw, err := json.Marshal(Config{})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"Theme", "Template", "ZgType", "InkColor", "InkAlpha", "FontWeight",
		"fontURL", "FontSource", "ResourceMode", "Page", "Margin",
		"DefaultPort", "BindAddr",
	}
	for _, k := range want {
		if _, ok := m[k]; !ok {
			t.Errorf("Config 缺少 JSON 键 %q（实际键：%v）", k, keysOf(m))
		}
	}
	/* 嵌套结构为对象（非点号扁平键），且键名与前端一致 */
	page, ok := m["Page"].(map[string]any)
	if !ok {
		t.Fatalf("Page 应为对象，实际 %T", m["Page"])
	}
	for _, k := range []string{"width", "height"} {
		if _, ok := page[k]; !ok {
			t.Errorf("Page 缺少键 %q", k)
		}
	}
	fs0, ok := m["FontSource"].(map[string]any)
	if !ok {
		t.Fatalf("FontSource 应为对象，实际 %T", m["FontSource"])
	}
	if _, ok := fs0["type"]; !ok {
		t.Error("FontSource 缺少键 type")
	}
	if strings.Contains(strings.Join(keysOf(m), ","), ".") {
		t.Error("顶层不应出现点号扁平键")
	}
}

func TestServerMetaAppIdentity(t *testing.T) {
	/* 单实例探测依赖 app == "motie"；此处固定契约字面量 */
	const app = "motie"
	raw, _ := json.Marshal(ServerMeta{App: app, Port: 39130})
	if !strings.Contains(string(raw), `"app":"motie"`) {
		t.Fatalf("ServerMeta 序列化异常：%s", raw)
	}
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
