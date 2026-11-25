// 由 cmd/typegen 从 internal/domain 生成，请勿手改（修改 Go 结构后运行 go run ./cmd/typegen）。
// 契约镜像：zitie.config 键名（Page/Margin/FontSource 为嵌套对象）。

export interface PageSize {
	width: number;
	height: number;
}

export interface Margin {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface FontSource {
	type: string;
	url: string;
	id: string;
}

export interface Config {
	Theme: string;
	Template: string;
	ZgType: string;
	InkColor: string;
	InkAlpha: number;
	FontWeight: string;
	FontURL: string;
	FontSource: FontSource;
	ResourceMode: string;
	Page: PageSize;
	Margin: Margin;
	DefaultPort: number;
	BindAddr: string;
}

export interface ServerMeta {
	app: string;
	version: string;
	port: number;
}

export interface WorkspaceFile {
	path: string;
	content: string;
	mod_time: string;
}

export interface FontEntry {
	id: string;
	name: string;
	source: string;
	path: string;
	size: unknown /* int64 */;
	created_at: string;
	enabled: boolean;
}

export interface PrintRequest {
	html: string;
}

export interface ConfigResponse extends ServerMeta {
	config: Config;
}

export const EVENTS = {
	ConfigChanged: 'config.changed',
	FileSaved: 'file.saved',
	FontAdded: 'font.added',
	PDFSaved: 'pdf.saved',
} as const;

export type EventName = typeof EVENTS[keyof typeof EVENTS];
