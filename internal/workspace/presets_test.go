package workspace

import (
	"errors"
	"path/filepath"
	"testing"
)

func newSvc(t *testing.T) *PresetService {
	t.Helper()
	return NewPresetService(filepath.Join(t.TempDir(), "workspace", "presets.json"))
}

func TestPresetCRUDAndPersist(t *testing.T) {
	svc := newSvc(t)
	if m, err := svc.List(); err != nil || len(m) != 0 {
		t.Fatalf("初始应为空：%+v, %v", m, err)
	}
	snap := map[string]any{"Template": "trace", "Cols": 8, "Content": "天地玄黄"}
	if err := svc.Save("硬笔", snap); err != nil {
		t.Fatal(err)
	}
	if err := svc.Save("软笔", map[string]any{"Template": "normal"}); err != nil {
		t.Fatal(err)
	}
	m, err := svc.List()
	if err != nil || len(m) != 2 {
		t.Fatalf("列表异常：%+v, %v", m, err)
	}
	/* 重建实例验证落盘（JSON 往返后数字为 float64） */
	svc2 := NewPresetService(svc.path)
	m2, err := svc2.List()
	if err != nil || len(m2) != 2 {
		t.Fatalf("重建后 %+v, %v", m2, err)
	}
	cols, ok := m2["硬笔"].(map[string]any)["Cols"].(float64)
	if !ok || cols != 8 {
		t.Fatalf("预设数据往返异常：%+v", m2["硬笔"])
	}
	/* 改名 */
	if err := svc.Rename("硬笔", "钢笔"); err != nil {
		t.Fatal(err)
	}
	m3, _ := svc.List()
	if _, ok := m3["钢笔"]; !ok {
		t.Errorf("改名失败：%+v", m3)
	}
	if err := svc.Rename("钢笔", "软笔"); err == nil {
		t.Error("目标已存在应拒绝")
	}
	/* 删除 */
	if err := svc.Delete("钢笔"); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete("钢笔"); !errors.Is(err, ErrNoExist) {
		t.Errorf("重复删除应 ErrNoExist，实际 %v", err)
	}
}

func TestPresetBadName(t *testing.T) {
	svc := newSvc(t)
	for _, bad := range []string{"", " ", "a/b", "a\\b", string([]rune{'太', '长', '名'})} {
		name := bad
		if name == string([]rune{'太', '长', '名'}) {
			continue // 3 字符合法，单独构造超长
		}
		if err := svc.Save(name, map[string]any{}); !errors.Is(err, ErrBadName) {
			t.Errorf("Save(%q) 应 ErrBadName，实际 %v", name, err)
		}
	}
	long := ""
	for i := 0; i < 61; i++ {
		long += "字"
	}
	if err := svc.Save(long, map[string]any{}); !errors.Is(err, ErrBadName) {
		t.Errorf("超长名应 ErrBadName，实际 %v", err)
	}
	/* List 返回副本：调用方改动不影响内部 */
	m, _ := svc.List()
	m["x"] = 1
	if again, _ := svc.List(); len(again) != 0 {
		t.Error("List 未返回副本")
	}
}
