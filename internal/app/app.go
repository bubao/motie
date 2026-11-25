// Package app 是组合根：集中装配 config / files / pdf / print 服务与 api.Server，
// 新增实现只改这里；Close 幂等并注销进程级回调。
package app

import (
	"context"
	"errors"
	"io/fs"
	"path/filepath"
	"sync"

	"motie/internal/api"
	"motie/internal/config"
	"motie/internal/domain"
	"motie/internal/files"
	"motie/internal/fonts"
	"motie/internal/kindle"
	"motie/internal/pdf"
	"motie/internal/version"
	"motie/internal/workspace"
)

type Options struct {
	WebFS        fs.FS // //go:embed dist
	LiteFS       fs.FS // //go:embed lite（导出 Kindle 版用，可 nil）
	Version      string
	ExportDir    string   // PDF / Kindle 落盘目录（空 → 配置目录/pdf、配置目录/export）
	RecentsAt    string   // 最近文件列表路径（空 → 配置目录/recents.json）
	FontsSysDirs []string // 系统字体扫描目录（空 → fonts.SystemFontDirs()，非 darwin 为空）
	PresetsAt    string   // 预设 JSON 路径（空 → 配置目录/workspace/presets.json）
	ConfigHome   string   // 配置根目录（测试注入；空 → os.UserConfigDir()/motie）
}

type configService struct {
	dir string // 配置根目录（注入，便于测试）
	bus *api.Bus
}

/* Get/Set 即 api.ConfigService 契约；Set 成功后在总线上广播 config.changed。 */
func (s *configService) Get() (domain.Config, error) { return config.LoadFrom(s.dir) }

func (s *configService) Set(c domain.Config) error {
	if err := config.SaveTo(s.dir, c); err != nil {
		return err
	}
	s.bus.Publish(domain.EventConfigChanged, c)
	return nil
}

type App struct {
	opts Options

	ctx    context.Context
	cancel context.CancelFunc
	bus    *api.Bus

	Config  *configService
	Files   *files.Service
	PDF     *pdf.Service
	Fonts   *fonts.Service
	Presets *workspace.PresetService
	Kindle  *kindle.Service
	Server  *api.Server

	closeOnce sync.Once
	closeErr  error
}

/* New 装配全部依赖；失败时不留半初始化状态。 */
func New(opts Options) (*App, error) {
	if opts.Version == "" {
		opts.Version = version.Version
	}
	base := opts.ConfigHome
	if base == "" {
		var err error
		base, err = config.AppConfigDir()
		if err != nil {
			return nil, err
		}
	}
	exportDir := opts.ExportDir
	if exportDir == "" {
		exportDir = filepath.Join(base, "pdf")
	}
	recentsAt := opts.RecentsAt
	if recentsAt == "" {
		recentsAt = filepath.Join(base, "recents.json")
	}
	presetsAt := opts.PresetsAt
	if presetsAt == "" {
		presetsAt = filepath.Join(base, "workspace", "presets.json")
	}
	sysDirs := opts.FontsSysDirs
	if sysDirs == nil {
		sysDirs = fonts.SystemFontDirs()
	}

	ctx, cancel := context.WithCancel(context.Background())
	bus := api.NewBus()

	/* 文件服务受控子树：应用数据目录下的 workspace / export（前端只传相对路径）。 */
	fileSvc, err := files.NewScoped(
		files.FileRecentStore{Path: recentsAt},
		base,
		[]string{"workspace", "export"},
	)
	if err != nil {
		cancel()
		return nil, err
	}

	a := &App{
		opts:    opts,
		ctx:     ctx,
		cancel:  cancel,
		bus:     bus,
		Config:  &configService{dir: base, bus: bus},
		Files:   fileSvc,
		PDF:     pdf.New(exportDir),
		Fonts:   fonts.New(filepath.Join(base, "fonts"), filepath.Join(base, "fonts", "index.json"), sysDirs),
		Presets: workspace.NewPresetService(presetsAt),
		Kindle:  kindle.New(opts.LiteFS, filepath.Join(base, "export")),
	}
	a.Server = api.New(api.Deps{
		Config:  a.Config,
		Files:   a.Files,
		PDF:     a.PDF,
		Fonts:   a.Fonts,
		Presets: a.Presets,
		Kindle:  a.Kindle,
		Update:  api.NewUpdater(api.UpdateRepo, opts.Version),
		WebFS:   opts.WebFS,
		Bus:     bus,
		Version: opts.Version,
	})
	return a, nil
}

/* Ctx 作为 http.Server.BaseContext 的根；Close 后所有在途请求一并取消。 */
func (a *App) Ctx() context.Context { return a.ctx }

/* Version 与启动日志、REST 元信息口径一致。 */
func (a *App) Version() string { return a.opts.Version }

/* Close 幂等：取消根 Context、关闭事件总线订阅。 */
func (a *App) Close() error {
	a.closeOnce.Do(func() {
		a.cancel()
	})
	return a.closeErr
}

var ErrNotRunning = errors.New("not running")
