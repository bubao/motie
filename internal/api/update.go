// 更新检查：查 GitHub Releases 的 latest tag 并与当前版本比较。
//
// 只做「提示有新版 + 打开发布页」，不自动下载/安装（macOS 分发给朋友场景，
// 用户手动从 GitHub Release 取包；避免引入签名/公证之外的复杂链路）。
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

/* 仓库标识（与 .goreleaser.yaml 的 homepage 保持一致）。 */
const UpdateRepo = "bubao/motie"

/* UpdateInfo 是 /api/update/latest 的响应体。 */
type UpdateInfo struct {
	Current     string `json:"current"`
	Latest      string `json:"latest"`
	URL         string `json:"url,omitempty"`
	PublishedAt string `json:"published_at,omitempty"`
	Newer       bool   `json:"newer"`
}

const updateCacheTTL = 10 * time.Minute

// Updater 带内存短缓存，避免用户反复点击时打爆 GitHub 接口。
type Updater struct {
	repo    string
	current string
	apiBase string
	client  *http.Client

	mu       sync.Mutex
	cached   *UpdateInfo
	cachedAt time.Time
}

func NewUpdater(repo, current string) *Updater {
	return &Updater{
		repo:    repo,
		current: current,
		apiBase: "https://api.github.com",
		client:  &http.Client{Timeout: 8 * time.Second},
	}
}

// Latest 返回最新版本信息；10 分钟内的重复调用走缓存。
func (u *Updater) Latest(ctx context.Context) (UpdateInfo, error) {
	u.mu.Lock()
	if u.cached != nil && time.Since(u.cachedAt) < updateCacheTTL {
		info := *u.cached
		u.mu.Unlock()
		return info, nil
	}
	u.mu.Unlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		u.apiBase+"/repos/"+u.repo+"/releases/latest", nil)
	if err != nil {
		return UpdateInfo{}, fmt.Errorf("查询更新失败: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "motie-desktop")

	resp, err := u.client.Do(req)
	if err != nil {
		return UpdateInfo{}, fmt.Errorf("查询更新失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		/* 仓库还没有任何 Release：视为「尚未发布」，不是错误 */
		info := UpdateInfo{Current: u.current}
		u.mu.Lock()
		u.cached = &info
		u.cachedAt = time.Now()
		u.mu.Unlock()
		return info, nil
	}
	if resp.StatusCode != http.StatusOK {
		return UpdateInfo{}, fmt.Errorf("查询更新失败: GitHub 返回 %s", resp.Status)
	}

	var payload struct {
		TagName     string `json:"tag_name"`
		HTMLURL     string `json:"html_url"`
		PublishedAt string `json:"published_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return UpdateInfo{}, fmt.Errorf("解析更新信息失败: %w", err)
	}

	latest := strings.TrimPrefix(strings.TrimSpace(payload.TagName), "v")
	info := UpdateInfo{
		Current:     u.current,
		Latest:      latest,
		URL:         payload.HTMLURL,
		PublishedAt: payload.PublishedAt,
		Newer:       compareVersions(latest, u.current) > 0,
	}

	u.mu.Lock()
	u.cached = &info
	u.cachedAt = time.Now()
	u.mu.Unlock()
	return info, nil
}

/*
compareVersions 按点分数字段比较两个版本号（允许 v 前缀与非数字后缀）。

	返回 -1 / 0 / 1。无法解析的字段按 0 计。
*/
func compareVersions(a, b string) int {
	pa := strings.Split(strings.TrimPrefix(strings.TrimSpace(a), "v"), ".")
	pb := strings.Split(strings.TrimPrefix(strings.TrimSpace(b), "v"), ".")
	n := len(pa)
	if len(pb) > n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		na, nb := leadingNumber(segmentAt(pa, i)), leadingNumber(segmentAt(pb, i))
		if na != nb {
			if na < nb {
				return -1
			}
			return 1
		}
	}
	return 0
}

func segmentAt(parts []string, i int) string {
	if i < len(parts) {
		return parts[i]
	}
	return ""
}

/* leadingNumber 取字符串前导数字（"1-beta" → 1，"" → 0）。 */
func leadingNumber(s string) int {
	end := 0
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0
	}
	n, err := strconv.Atoi(s[:end])
	if err != nil {
		return 0
	}
	return n
}
