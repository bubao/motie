package version

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

/* REST /api/config 与界面口径一致的前提：Go 常量 == package.json version。 */
func TestMatchesPackageJSON(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	var pkg struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		t.Fatal(err)
	}
	if pkg.Version == "" {
		t.Fatal("package.json 缺少 version")
	}
	if Version != pkg.Version {
		t.Errorf("version.Version = %q，package.json = %q", Version, pkg.Version)
	}
}
