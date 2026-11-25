/**
 * 常量与配置（localStorage 持久化）。
 * 标准版核心模块；lite 使用独立副本（lite-src/vendor/，逻辑同源、语法风格有意不同步）。
 * 各模块通过显式 import 复用，不再挂全局命名空间。
 *
 * 配置没有全局单例：调用方（Redux store / 测试）通过 loadConfig() 取一份
 * 全新配置对象，saveConfig(cfg) 落盘；预设读写为独立函数。
 */
export const STORAGE_KEY = 'zitie.config';
export const PRESETS_KEY = 'zitie.presets'; /* 具名预设（设置偏好，不含内容） */
export const FONTS_KEY = 'zitie.fonts';     /* 已导入本地字体的元数据（二进制在 IndexedDB） */
export const LEGACY_STORAGE_KEY = 'zitie-lite.config'; /* 精简版旧配置键，读取时迁移一次 */
/* 「示例」按钮填充的文本（完整版与练字版共用） */
export const SAMPLE_TEXT = '天地玄黄 宇宙洪荒 日月盈昃 辰宿列张 寒来暑往 秋收冬藏';
/* 示例库（Panel 下拉选择；标点按 T0.8 规则不占格） */
export const SAMPLES = [
	{ name: '千字文·节选', text: '天地玄黄 宇宙洪荒 日月盈昃 辰宿列张 寒来暑往 秋收冬藏', mode: 'hanzi' },
	{ name: '三字经·节选', text: '人之初，性本善。性相近，习相远。苟不教，性乃迁。教之道，贵以专。', mode: 'hanzi' },
	{ name: '静夜思', text: '床前明月光，疑是地上霜。举头望明月，低头思故乡。', mode: 'hanzi' },
	{ name: '登鹳雀楼', text: '白日依山尽，黄河入海流。欲穷千里目，更上一层楼。', mode: 'hanzi' },
	{ name: '春晓', text: '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。', mode: 'hanzi' },
	{ name: '论语·学而', text: '学而时习之，不亦说乎？有朋自远方来，不亦乐乎？', mode: 'hanzi' },
	/* 笔画示例：按最长匹配切分（横竖撇捺点提折钩 / 永字八法），可继续追加 */
	{ name: '基本笔画', text: '横竖撇捺点提折钩', mode: 'stroke' },
	{ name: '永字八法', text: '点横竖钩提撇短撇捺', mode: 'stroke' },
	/* 字帖类型示例（B1 / B2 / B3）：切到对应模式后选用，数字推荐「数字本」字格 */
	{ name: '数字 0-9', text: '0123456789', mode: 'number' },
	{ name: '拼音字母（带调）', text: 'āáǎà ēéěè īíǐì ōóǒò ūúǔù ǖǘǚǜ', mode: 'pinyin' },
	{ name: '英文字母', text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz', mode: 'english' }
];
export const MAX_CONTENT_LENGTH = 5000;
export const MAX_TITLE_LENGTH = 40;
export const MIN_GRID_SIZE = 40;
export const MAX_GRID_SIZE = 160;
export const MIN_GRID_RATIO = 60;   /* 宽高比下限（×0.60）；0 = 自动（随字格类型） */
export const MAX_GRID_RATIO = 160;  /* 宽高比上限（×1.60） */
export const MIN_TRACE_MODEL = 1;   /* 节奏描红：每行最少范字格 */
export const MAX_TRACE_MODEL = 10;
export const MIN_TRACE_ROUNDS = 1;  /* 描红遍数：内容整体重复下限（1 = 不重复） */
export const MAX_TRACE_ROUNDS = 30; /* 上限，防超长内容撑爆页数 */
export const MIN_TRACE_TRACE = 0;   /* 每行描红格（其余为临写 blank） */
export const MAX_TRACE_TRACE = 10;
export const MIN_TRACE_DECAY = 0;   /* 每行递减描红格：0 = 不变 */
export const MAX_TRACE_DECAY = 5;
export const MIN_ZG_LINE_SCALE = 25;   /* 内部线宽倍率 ×100：×0.25 */
export const MAX_ZG_LINE_SCALE = 300;  /* ×3.00 */
export const MIN_ZG_BORDER_SCALE = 0;   /* 外框宽相对内部线百分比：0 = 自动（随字格类型） */
export const MAX_ZG_BORDER_SCALE = 300; /* ×3.00 */
export const MIN_ZG_OPACITY = 10;       /* 格线下限不透明度 %（再低打印几乎不可见） */
export const MAX_ZG_OPACITY = 100;
export const MIN_ZG_DASH_DENSITY = 25;  /* 虚线密度 ×100：×0.25（密） */
export const MAX_ZG_DASH_DENSITY = 200; /* ×2.00（疏） */
/* 格型内部比例参数（单位见各字段注释） */
export const MIN_ZG_INNER_RATIO = 15;  /* 回字内框水平边距占格宽 % */
export const MAX_ZG_INNER_RATIO = 45;
export const MIN_ZG_ENG_MID = 60;      /* 英文格中间区占比 ×300（100 = 1/3，与等分一致） */
export const MAX_ZG_ENG_MID = 180;
export const MIN_ZG_PINYIN_TOP = 20;   /* 拼音格上区高度占整格 % */
export const MAX_ZG_PINYIN_TOP = 50;
export const MIN_ZG_BASELINE_POS = 40; /* 数字格基线距顶 % */
export const MAX_ZG_BASELINE_POS = 85;
export const MIN_TRACE_COUNT = 1;
export const MIN_BLANK_EVERY = 0;   /* 练习密度间隔下限：0 = 关闭 */
export const MAX_BLANK_EVERY = 5;   /* 每 N 行 / 列插 1 个空临格 */
export const MAX_TRACE_COUNT = 6;
export const MIN_REPEAT_COUNT = 1;  /* 单元重复：每行描红格数下限（列数 = N+1） */
export const MAX_REPEAT_COUNT = 30;
export const MIN_CHAR_GAP = 0;      /* 字间距下限 %：0 = 格子紧邻 */
export const MAX_CHAR_GAP = 30;     /* 字间距上限 %：间隙 = 格宽 × 该值 */
export const MIN_COLS = 1;
export const MAX_COLS = 20;
export const MIN_GAP = 0;
export const MAX_GAP = 1;
export const MIN_INK_ALPHA = 0.15;
export const MAX_INK_ALPHA = 1;
export const MIN_CHAR_SCALE = 0.5; /* 字占格比例区间（格倍数） */
export const MAX_CHAR_SCALE = 1;
export const MIN_CHAR_OFFSET = -0.25; /* 字体在格内的水平 / 垂直偏移区间（格倍数） */
export const MAX_CHAR_OFFSET = 0.25;

/* 构建时可注入 window.ZITIE_BOOT.ResourceMode 指定默认资源来源（见 tools/build.js） */
const boot = (typeof window !== 'undefined' && window.ZITIE_BOOT) || {};

export const DEFAULTS = {
	Mode: 'hanzi',       /* 字符集模式：hanzi / stroke / number / pinyin / english / control */
	EngPairCase: false,  /* 英文模式：每个字母按「大写 + 小写」两格展开（Aa Bb…）；仅解析期生效 */
	/* 各字帖类型独立记忆（tab 切换）：切走保存、切回恢复；随 zitie.config 主链落盘 / 多标签同步 / 导入导出 */
	ModeStates: {},
	/* 控笔练习图案（仅 Mode='control' 生效）：图案库 key，见 CONTROL_PATTERNS */
	ControlPattern: 'line-h',
	ControlRows: 0,       /* 控笔练习行数（仅 Mode='control' 生效）：0 = 按内容行（留空为满页） */
	Content: '永',
	Title: '',            /* 内容标题（可选，居中显示在字帖开头） */
	Template: 'normal',   /* 排版模板：normal / trace / trace3 / lead / repeat / rhythm / blank */
	HighlightFirst: false, /* 每行首字强制范字（深色），其余按模板 */
	TraceCount: 3,        /* 一字三描红：每行前 N 格为深色范字（仅模板 trace3 生效） */
	TraceRounds: 1,      /* 描红数量 / 重复遍数（对齐 z2h）：整段内容重复 N 遍，首遍按模板、其余描红；1 = 不重复 */
	Cols: 0,              /* 每行格数：0 = 按纸张自适应 */
	RowGap: 0.12,         /* 行距（相对行盒高倍数：拼音格随 1.4×格等比放大） */
	CharGap: 0,           /* 字间距 %（0–30）：格间额外间隙 = 格宽 × 该值；列数按有效步距自适应 */
	BlankRowEvery: 0,     /* 练习密度：每 N 行内容插 1 整行空临格；0 = 关（english / control 不生效） */
	BlankColEvery: 0,     /* 练习密度：每 N 列内容插 1 个空临格；0 = 关（english / control 不生效） */
	VerticalAlign: 'center', /* 行区垂直对齐：center 居中 / top 靠顶 / bottom 靠底（行距不变） */
	InkColor: 'cinnabar', /* 文字颜色：cinnabar / ink / ochre */
	InkAlpha: 0.62,       /* 文字深浅 0.15–1 */
	FontWeight: 'normal', /* 字体粗细：normal / bold */
	CharScale: 0.725,     /* 字占格比例（屏幕 / 打印 / PDF 同源） */
	TraceColor: 'auto',   /* 描红颜色：auto / cinnabar / ink / ochre */
	CharOffsetX: 0,       /* 字体在格内的水平偏移（格倍数，-0.25–0.25） */
	CharOffsetY: 0,       /* 字体在格内的垂直偏移（格倍数） */
	ZgType: '3',     /* 字格样式：1 田 / 2 米 / 3 米回 / 4 回 / 5 拼音 / 6 方格 / 7 数字 / 8 井字 / 9 英文四线（5–9 仅完整版） */
	ZgColor: '1',    /* 字格预设色：1 绿 / 2 灰 / 3 红 / 4 蓝；实际颜色取 ZgLineColor / ZgBorderColor（空则回退本预设） */
	ZgLineColor: '',    /* 内部线颜色 #rrggbb；空 = 跟随 ZgColor 预设 line 色 */
	ZgBorderColor: '',  /* 外框颜色 #rrggbb；空 = 跟随 ZgColor 预设 border 色 */
	ZgOpacity: 100,     /* 格线整体不透明度 %（10–100） */
	GridSize: 80,    /* 格子宽（px，理想值 → 决定列数，实际格宽均分铺满） */
	GridRatio: 0,    /* 格子宽高比 ×100：0 = 自动（拼音格 1.4，其余 1.0）；60–160 = 用户值 */
	TraceModel: 1,   /* 节奏描红：每行前 N 格范字（深） */
	TraceTrace: 3,   /* 节奏描红：每行接着 M 格描红（浅），其余临写（空临格） */
	TraceDecay: 0,   /* 节奏描红：每行递减的描红格数（逐行变少） */
	RepeatUnit: 'char',   /* 单元重复（Template='repeat'）：char 单字 / word 词组；每个单元独占一行 */
	RepeatCount: 19,      /* 单元重复：每行描红格数（首格范字深色）；列数锁定为 N+1，格宽随之收缩 */
	ZgLineScale: 100, /* 内部线宽倍率 ×100（25–300，步进 25） */
	ZgBorderScale: 0,   /* 外框宽相对内部线的百分比：0 = 自动（拼音格 100，其余 200） */
	ZgLineMode: 'solid', /* 格外框样式：solid 实线 / dashed 虚线 / none 无框 */
	ZgInnerLineMode: 'dashed', /* 内部辅助线样式：solid / dashed / none */
	ZgDashStyle: 'dash', /* 虚线形态：dash 划线 / dot 圆点 / dashdot 点划线 */
	ZgDashDensity: 100,  /* 虚线密度 ×100（25–200，步进 25） */
	ZgInnerRatio: 25,    /* 回字内框水平边距占格宽 %（15–45，仅 type 3/4） */
	ZgEngMid: 100,       /* 英文格中间区占比 ×300（60–180；100 = 1/3，仅 type 9） */
	ZgPinyinTop: 29,     /* 拼音格上区高度占整格 %（20–50，仅 type 5） */
	ZgBaselinePos: 66,   /* 数字格基线距顶 %（40–85，仅 type 7） */
	ZgStartDot: false,   /* 起笔点标记（仅 type 1/2/3/4/8） */
	ZgLineCap: 'butt',   /* 线端样式：butt / round / square */
	ZgCrisp: false,      /* 细线锐利（shape-rendering: crispEdges） */
	ShowPinyin: true,  /* 「显示拼音」总开关：拼音格（type5，格内上区）与格上拼音条（type10）生效 */
	PinyinBar: false,    /* 格上拼音条（对齐 z2h「显示拼音」）：开启后格型自动切到 '10'（田字格 + 顶部窄条），关闭回退田字格 */
	StrokeAnim: true,  /* 点击字格播放笔顺动画 */
	StrokeOrder: false, /* 每格叠加静态笔顺序号（1..n，屏幕 / 打印 / PDF 同源） */
	Page: { width: 210, height: 297 },                 /* 纸张尺寸（mm），与 sheet-layout 内置默认一致 */
	Margin: { top: 5, right: 16, bottom: 5, left: 16 }, /* 页边距（mm），与 @page / sheet-layout 一致 */
	Name: '',            /* 姓名（元信息，可打印 / 导出 PDF） */
	ShowMeta: false,     /* 每页底部显示「姓名 / 日期」 */
	ShowPageNo: true,    /* 屏幕 / 打印 / PDF 显示页码 */
	fontURL: '',
	FontSource: { type: 'default' },           /* 字体来源：default 系统默认 / url 网络地址 / local 本地字体（id） */
	PreviewText: '天地玄黄，宇宙洪荒',           /* 字体管理器的预览字样 */
	Theme: 'system',    /* 外观：light / dark / system（跟随系统） */
	ResourceMode: boot.ResourceMode === 'local' ? 'local' : 'cdn' /* 第三方资源来源：cdn（默认）/ local（本地 vendor，需 http 托管） */
};

/* 排版模板（顺序即界面顺序） */
export const TEMPLATES = [
	{ key: 'normal', name: '正常' },
	{ key: 'trace', name: '整页描红' },
	{ key: 'trace3', name: '一字三描红' },
	{ key: 'lead', name: '首字范字' },
	{ key: 'repeat', name: '单元重复' },
	{ key: 'rhythm', name: '节奏描红' },
	{ key: 'blank', name: '空临格' }
];
/* 单元重复的单元粒度：char 单字 / word 词组（按空白分词，词不拆行） */
export const REPEAT_UNITS = ['char', 'word'];
export const REPEAT_UNIT_NAMES = { char: '单字', word: '词组' };
export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key);

/* 格线（外框）样式：实线 / 虚线 / 无框 */
export const ZG_LINE_MODES = ['solid', 'dashed', 'none'];
export const ZG_LINE_MODE_NAMES = { solid: '实线', dashed: '虚线', none: '无框' };

/* 文字颜色 */
export const INK_COLORS = {
	cinnabar: '#B03A2C', /* 朱砂 */
	ink: '#23262B',      /* 墨色 */
	ochre: '#A9713A'     /* 赭石 */
};
export const INK_COLOR_KEYS = ['cinnabar', 'ink', 'ochre'];

/* 描红颜色：auto = 跟随范字色并降透明度；也可独立选色 */
export const TRACE_COLOR_KEYS = ['auto', ...INK_COLOR_KEYS];
export const TRACE_COLOR_NAMES = { auto: '自动', cinnabar: '朱砂', ink: '墨色', ochre: '赭石' };

/* 文字颜色对应的 RGB 分量（供 CSS rgba(var(--ink-rgb), var(--ink-alpha)) 使用） */
export const INK_RGB = {
	cinnabar: '176, 58, 44',
	ink: '35, 38, 43',
	ochre: '169, 113, 58'
};

export const ZG_TYPES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
export const ZG_COLORS = ['1', '2', '3', '4'];

/* 行区垂直对齐（行距不变，只改空白分布） */
export const VERTICAL_ALIGNS = ['center', 'top', 'bottom'];

/* 字格配色：内部线颜色 + 外框颜色 */
export const ZG_COLOR_VALUES = {
	'1': { line: '#70d39d', border: '#00b050' }, /* 绿色 */
	'2': { line: '#666666', border: '#111111' }, /* 灰色 */
	'3': { line: '#bb3442', border: '#980f29' }, /* 红色 */
	'4': { line: '#6f9fd8', border: '#1f5aa8' }  /* 蓝色 */
};

/* 虚线形态：划线 / 圆点 / 点划线 */
export const ZG_DASH_STYLES = ['dash', 'dot', 'dashdot'];
export const ZG_DASH_STYLE_NAMES = { dash: '划线', dot: '圆点', dashdot: '点划线' };

/* 线端样式：butt（默认，不输出属性）/ round / square */
export const ZG_LINE_CAPS = ['butt', 'round', 'square'];
export const ZG_LINE_CAP_NAMES = { butt: '平头', round: '圆头', square: '方头' };

/* 格型适用场景说明（面板选中项下方展示） */
export const ZG_TYPE_HINTS = {
	'1': '一格一字，横竖中线辅助定位。',
	'2': '在田字基础上加两条对角线，适合笔画角度练习。',
	'3': '米字线 + 内框，兼顾笔画走向与间架结构。',
	'4': '外框 + 内框，突出字的重心区域。',
	'5': '上区四线三格写拼音，下区田字格写字。',
	'10': '格上方窄条写拼音，下方田字格写字（对齐 z2h「显示拼音」）。',
	'6': '作文纸式纯方格，标点也占格。',
	'7': '数学本式横线格，基线以上写字。',
	'8': '九宫格，三分法定位笔画。',
	'9': '四线三格，中间区为字母主体高度。'
};

/* 推荐搭配：一键套用一组外观字段（不含颜色与格子大小）。 */
export const ZG_SCHEMES = [
	{
		key: 'lowgrade', name: '低年级',
		apply: { ZgType: '1', ZgLineMode: 'solid', ZgInnerLineMode: 'dashed', ZgBorderScale: 150, ZgLineScale: 100, ZgDashStyle: 'dash', ZgDashDensity: 100, ZgStartDot: true }
	},
	{
		key: 'english', name: '英语本',
		apply: { ZgType: '9', ZgLineMode: 'solid', ZgInnerLineMode: 'dashed', ZgBorderScale: 200, ZgLineScale: 100, ZgDashStyle: 'dash', ZgDashDensity: 100, ZgOpacity: 100, ZgEngMid: 100 }
	},
	{
		key: 'brush', name: '毛笔隶书',
		apply: { ZgType: '2', ZgLineMode: 'solid', ZgInnerLineMode: 'solid', ZgBorderScale: 100, ZgLineScale: 75, ZgOpacity: 90, ZgDashStyle: 'dash' }
	}
];

export const FONT_FORMATS = {
	woff2: 'woff2',
	woff: 'woff',
	ttf: 'truetype',
	otf: 'opentype',
	eot: 'embedded-opentype'
};

/* 字体粗细（屏幕 / 打印 / PDF 同源） */
export const FONT_WEIGHTS = ['normal', 'bold'];
export const FONT_WEIGHT_NAMES = { normal: '常规', bold: '加粗' };
export const FONT_WEIGHT_NUM = { normal: 400, bold: 700 };

/* 字帖字符集模式：决定内容解析哪些字符为字格；stroke = 笔画（矢量剪影）；control = 控笔练习（图案，非文字） */
export const MODES = ['hanzi', 'stroke', 'number', 'pinyin', 'english', 'control'];
export const MODE_NAMES = { hanzi: '汉字', stroke: '笔画', number: '数字', pinyin: '拼音', english: '英文', control: '控笔' };
/* 切换模式时推荐的字格类型（用户可再改）；笔画 / 控笔用米字回字 / 田字格（剪影叠加在格内） */
export const MODE_ZG = { hanzi: '3', stroke: '3', number: '7', pinyin: '5', english: '1', control: '1' };

/*
 * 内容形态预置：一键套用「模式 + 版式」组合（z2h 式形态分流）。
 * apply 字段必须是 ConfigSchema 已登记字段；Mode 变化时走 switchMode（保留各类型独立记忆），
 * 其余字段由 store.applyFields 单次历史快照批量套用。
 */
export const CONTENT_FORMS = [
	{ key: 'lead', name: '首字范字', apply: { Mode: 'hanzi', ZgType: '3', Template: 'lead' } },
	{ key: 'trace', name: '整页描红', apply: { Mode: 'hanzi', ZgType: '3', Template: 'trace' } },
	{ key: 'rounds', name: '反复描红', apply: { Mode: 'hanzi', ZgType: '3', Template: 'normal', TraceRounds: 10 } },
	{ key: 'rhythm', name: '节奏描红', apply: { Mode: 'hanzi', ZgType: '3', Template: 'rhythm', TraceModel: 1, TraceTrace: 3, TraceDecay: 0 } },
	{ key: 'blank', name: '空临格', apply: { Mode: 'hanzi', ZgType: '3', Template: 'blank' } },
	{ key: 'repeat', name: '单元重复', apply: { Mode: 'hanzi', ZgType: '3', Template: 'repeat', RepeatUnit: 'char', RepeatCount: 19 } },
	{ key: 'repeat-word', name: '词组', apply: { Mode: 'hanzi', ZgType: '3', Template: 'repeat', RepeatUnit: 'word', RepeatCount: 8 } },
	{ key: 'paragraph', name: '段落书写', apply: { Mode: 'hanzi', ZgType: '7', Template: 'normal', RowGap: 0.25, CharGap: 0 } },
	{ key: 'stroke', name: '笔画入门', apply: { Mode: 'stroke', ZgType: '3', Template: 'lead' } },
	{ key: 'number', name: '数字练习', apply: { Mode: 'number', Template: 'lead' } },
	{ key: 'english', name: '英文字母', apply: { Mode: 'english', Template: 'normal' } },
	{ key: 'english-word', name: '英文单词', apply: { Mode: 'english', ZgType: '9', Template: 'normal', EngPairCase: false, CharScale: 0.85 } },
	{ key: 'english-paragraph', name: '英文段落', apply: { Mode: 'english', ZgType: '9', Template: 'normal', RowGap: 0.25 } },
	{ key: 'control', name: '控笔训练', apply: { Mode: 'control', ControlPattern: 'line-h', ControlRows: 8 } },
	/* 逐行序列：内容用图形字符（1-9 / A-R）逐行指定图案，演示 z2h PenControl 式编排 */
	{ key: 'control-seq', name: '控笔序列', apply: { Mode: 'control', ControlPattern: 'line-h', ControlRows: 0, Content: '123456' } }
];

/* 版式偏好白名单（P2-8）：预设 / 类型快照只覆盖版式字段，不含字体 / 主题 / 资源 */
export const PRESET_KEYS = ['Template', 'RepeatUnit', 'RepeatCount', 'TraceCount', 'TraceRounds', 'Cols', 'RowGap', 'CharGap', 'BlankRowEvery', 'BlankColEvery', 'VerticalAlign', 'Page', 'Margin', 'ZgType', 'ZgColor', 'GridSize', 'GridRatio', 'ShowPinyin', 'PinyinBar'];
/* 类型快照字段：版式白名单 + 节奏描红 / 首字高亮 / 控笔行数 + 内容与标题 */
export const MODE_SNAPSHOT_FIELDS = PRESET_KEYS.concat(['HighlightFirst', 'TraceModel', 'TraceTrace', 'TraceDecay', 'ControlRows', 'Content', 'Title']);

/* 从配置中摘出类型快照（内容 + 版式 + 模式）；供类型记忆与撤销栈共用 */
export const pickModeSnapshot = (cfg) => {
	var out = { Mode: cfg.Mode };
	MODE_SNAPSHOT_FIELDS.forEach((k) => { out[k] = cfg[k]; });
	return out;
};

/* 首次进入某类型的推荐状态：默认版式 + 推荐字格 + 推荐字内偏移，内容 / 标题为空。
 * CharOffsetY 单位是格倍数（配置存小数）：数字落横线格基线区（下移）、拼音字母偏上；
 * 笔画配合单元重复模板，推荐每行描红 5 格。 */
export const defaultModeState = (mode) => {
	var out = {};
	MODE_SNAPSHOT_FIELDS.forEach((k) => { out[k] = DEFAULTS[k]; });
	out.ZgType = MODE_ZG[mode] || DEFAULTS.ZgType;
	/* 字内偏移不在快照白名单（属文字组），此处显式给全量，保证各类型都有确定初值 */
	out.CharOffsetX = DEFAULTS.CharOffsetX;
	out.CharOffsetY = DEFAULTS.CharOffsetY;
	if (mode === 'pinyin') out.ShowPinyin = false; /* 内容即拼音（B2） */
	if (mode === 'number') out.CharOffsetY = 0.2;  /* 数字本基线以上写字 */
	if (mode === 'pinyin') out.CharOffsetY = -0.12; /* 拼音字母略偏上 */
	if (mode === 'stroke') out.RepeatCount = 5;    /* 单元重复：笔画每行 1 范 + 5 描红 */
	out.Content = '';
	out.Title = '';
	return out;
};

/* 归一化类型记忆：仅保留已知模式键与已知字段，逐字段按 Schema 归一化（丢弃未知键） */
export const normalizeModeStates = (value) => {
	var v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	var out = {};
	MODES.forEach((m) => {
		var snap = v[m];
		if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return;
		var entry = {};
		MODE_SNAPSHOT_FIELDS.forEach((k) => { entry[k] = normalizeField(k, snap[k]); });
		out[m] = entry;
	});
	return out;
};

/* 控笔练习图案库（C1）：每格一个图案，屏幕 / 打印 / PDF 由 control.js 生成同源 SVG。
 * key 即 ContentModel 行单元的 char 字段值（pattern），不是可渲染文字。
 * alias：单个字符（1-9、A-R），供 control 模式「内容即图形序列」逐行编排
 * （对齐 z2h PenControl 的字符网格交互，但图形仍走矢量剪影，不用字体承载）。 */
export const CONTROL_PATTERNS = [
	{ key: 'line-h', name: '横线', alias: '1' },
	{ key: 'line-v', name: '竖线', alias: '2' },
	{ key: 'line-slash', name: '斜线', alias: '3' },
	{ key: 'line-backslash', name: '反斜线', alias: '4' },
	{ key: 'wave', name: '波浪', alias: '5' },
	{ key: 'teeth', name: '锯齿', alias: '6' },
	{ key: 'zigzag', name: '折线', alias: '7' },
	{ key: 'arc', name: '圆弧', alias: '8' },
	{ key: 'arch', name: '拱形', alias: '9' },
	{ key: 's-curve', name: 'S 形', alias: 'A' },
	{ key: 'spiral', name: '螺旋', alias: 'B' },
	{ key: 'circle', name: '圆圈', alias: 'C' },
	{ key: 'dot', name: '圆点', alias: 'D' },
	{ key: 'steps', name: '阶梯', alias: 'E' },
	{ key: 'cross', name: '十字', alias: 'F' },
	{ key: 'square', name: '方框', alias: 'G' },
	{ key: 'square-in', name: '回字', alias: 'H' },
	{ key: 'spiral-square', name: '方螺旋', alias: 'I' },
	{ key: 'cross-diag', name: '交叉线', alias: 'J' },
	{ key: 'diamond', name: '菱形', alias: 'K' },
	{ key: 'tee', name: 'T 形', alias: 'L' },
	{ key: 'hourglass', name: '沙漏', alias: 'M' },
	{ key: 'bars', name: '高低竖线', alias: 'N' },
	{ key: 'dash-h', name: '断续横线', alias: 'O' },
	{ key: 'dash-v', name: '断续竖线', alias: 'P' },
	{ key: 'circle-in', name: '同心圆', alias: 'Q' },
	{ key: 'triangle', name: '三角', alias: 'R' }
];
export const CONTROL_PATTERN_KEYS = CONTROL_PATTERNS.map((p) => p.key);
export const CONTROL_PATTERN_NAMES = CONTROL_PATTERNS.reduce((acc, p) => {
	acc[p.key] = p.name;
	return acc;
}, {});
/* 别名 → key（control 内容解析用）；别名为稳定标识，新增图案只追加、不改旧值 */
export const CONTROL_ALIAS_TO_KEY = CONTROL_PATTERNS.reduce((acc, p) => {
	acc[p.alias] = p.key;
	return acc;
}, {});
export const CONTROL_PATTERN_ALIASES = CONTROL_PATTERNS.map((p) => p.alias);

export const normalize = (value, allowed, fallback) => {
	const v = String(value);
	return allowed.includes(v) ? v : fallback;
};

export const normalizeSize = (value, fallback) => {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(n)));
};

/* 归一化整数区间 */
export const normalizeInt = (value, min, max, fallback) => {
	const n = parseInt(value, 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
};

/* 归一化小数区间 */
export const normalizeFloat = (value, min, max, fallback) => {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
};

/*
 * 配置字段 Schema：字段元数据的唯一真源。
 * type：text / enum / int / percent / bool；group 供设置面板分组渲染。
 * 新增字段只需在此登记，load/save 与设置层同步均按它派发。
 */
export const ConfigSchema = {
	Mode:       { type: 'enum', values: MODES, group: 'content' },
	EngPairCase: { type: 'bool', group: 'content' },
	ModeStates: { type: 'object', shape: 'modeStates', group: 'content' },
	ControlPattern: { type: 'enum', values: CONTROL_PATTERN_KEYS, group: 'content' },
	ControlRows: { type: 'int', min: 0, max: 200, step: 1, group: 'content', zeroLabel: '跟随内容' },
	Content:    { type: 'text', max: MAX_CONTENT_LENGTH, group: 'content' },
	Title:      { type: 'text', max: MAX_TITLE_LENGTH, group: 'content' },
	Template:   { type: 'enum', values: TEMPLATE_KEYS, group: 'layout' },
	HighlightFirst: { type: 'bool', group: 'layout' },
	TraceCount: { type: 'int', min: MIN_TRACE_COUNT, max: MAX_TRACE_COUNT, group: 'layout' },
	TraceRounds: { type: 'int', min: MIN_TRACE_ROUNDS, max: MAX_TRACE_ROUNDS, step: 1, group: 'layout' },
	TraceModel: { type: 'int', min: MIN_TRACE_MODEL, max: MAX_TRACE_MODEL, group: 'layout' },
	TraceTrace: { type: 'int', min: MIN_TRACE_TRACE, max: MAX_TRACE_TRACE, group: 'layout' },
	TraceDecay: { type: 'int', min: MIN_TRACE_DECAY, max: MAX_TRACE_DECAY, group: 'layout' },
	RepeatUnit: { type: 'enum', values: REPEAT_UNITS, group: 'layout' },
	RepeatCount: { type: 'int', min: MIN_REPEAT_COUNT, max: MAX_REPEAT_COUNT, step: 1, group: 'layout' },
	Cols:       { type: 'int', min: 0, max: MAX_COLS, group: 'layout', zeroLabel: '自适应' },
	RowGap:     { type: 'percent', min: MIN_GAP, max: MAX_GAP, group: 'layout' },
	CharGap:    { type: 'int', min: MIN_CHAR_GAP, max: MAX_CHAR_GAP, step: 5, group: 'layout' },
	BlankRowEvery: { type: 'int', min: MIN_BLANK_EVERY, max: MAX_BLANK_EVERY, step: 1, group: 'layout', zeroLabel: '关闭' },
	BlankColEvery: { type: 'int', min: MIN_BLANK_EVERY, max: MAX_BLANK_EVERY, step: 1, group: 'layout', zeroLabel: '关闭' },
	VerticalAlign: { type: 'enum', values: VERTICAL_ALIGNS, group: 'layout' },
	InkColor:   { type: 'enum', values: INK_COLOR_KEYS, group: 'text' },
	InkAlpha:   { type: 'percent', min: MIN_INK_ALPHA, max: MAX_INK_ALPHA, group: 'text' },
	FontWeight: { type: 'enum', values: FONT_WEIGHTS, group: 'text' },
	CharScale:  { type: 'percent', min: MIN_CHAR_SCALE, max: MAX_CHAR_SCALE, group: 'text' },
	TraceColor: { type: 'enum', values: TRACE_COLOR_KEYS, group: 'text' },
	CharOffsetX: { type: 'percent', min: MIN_CHAR_OFFSET, max: MAX_CHAR_OFFSET, group: 'text' },
	CharOffsetY: { type: 'percent', min: MIN_CHAR_OFFSET, max: MAX_CHAR_OFFSET, group: 'text' },
	ZgType:     { type: 'enum', values: ZG_TYPES, group: 'grid' },
	ZgColor:    { type: 'enum', values: ZG_COLORS, group: 'grid' },
	ZgLineColor:   { type: 'hex', group: 'grid' }, /* 空 = 跟随 ZgColor 预设 */
	ZgBorderColor: { type: 'hex', group: 'grid' },
	ZgOpacity:  { type: 'int', min: MIN_ZG_OPACITY, max: MAX_ZG_OPACITY, step: 5, group: 'grid' },
	ZgLineScale: { type: 'int', min: MIN_ZG_LINE_SCALE, max: MAX_ZG_LINE_SCALE, step: 25, group: 'grid' },
	ZgBorderScale: { type: 'int', min: MIN_ZG_BORDER_SCALE, max: MAX_ZG_BORDER_SCALE, step: 25, group: 'grid', zeroLabel: '自动' },
	ZgLineMode: { type: 'enum', values: ZG_LINE_MODES, group: 'grid' },
	ZgInnerLineMode: { type: 'enum', values: ZG_LINE_MODES, group: 'grid' },
	ZgDashStyle: { type: 'enum', values: ZG_DASH_STYLES, group: 'grid' },
	ZgDashDensity: { type: 'int', min: MIN_ZG_DASH_DENSITY, max: MAX_ZG_DASH_DENSITY, step: 25, group: 'grid' },
	ZgInnerRatio: { type: 'int', min: MIN_ZG_INNER_RATIO, max: MAX_ZG_INNER_RATIO, step: 5, group: 'grid' },
	ZgEngMid: { type: 'int', min: MIN_ZG_ENG_MID, max: MAX_ZG_ENG_MID, step: 15, group: 'grid' },
	ZgPinyinTop: { type: 'int', min: MIN_ZG_PINYIN_TOP, max: MAX_ZG_PINYIN_TOP, step: 5, group: 'grid' },
	ZgBaselinePos: { type: 'int', min: MIN_ZG_BASELINE_POS, max: MAX_ZG_BASELINE_POS, step: 5, group: 'grid' },
	ZgStartDot: { type: 'bool', group: 'grid' },
	PinyinBar: { type: 'bool', group: 'grid' }, /* 格上拼音条（ZgType 自动切 '10'）；预设 / 快照白名单见 PRESET_KEYS */
	ZgLineCap:  { type: 'enum', values: ZG_LINE_CAPS, group: 'grid' },
	ZgCrisp:    { type: 'bool', group: 'grid' },
	GridSize:   { type: 'int', min: MIN_GRID_SIZE, max: MAX_GRID_SIZE, step: 1, group: 'grid' },
	GridRatio:  { type: 'int', min: 0, max: MAX_GRID_RATIO, step: 5, group: 'grid', zeroLabel: '自动' },
	ShowPinyin: { type: 'bool', group: 'text' },
	StrokeAnim: { type: 'bool', group: 'layout' },
	StrokeOrder: { type: 'bool', group: 'text' },
	Page:          { type: 'object', group: 'layout' },
	Margin:        { type: 'object', group: 'layout' },
	Name:          { type: 'text', max: 12, group: 'meta' },
	ShowMeta:      { type: 'bool', group: 'meta' },
	ShowPageNo:    { type: 'bool', group: 'meta' },
	fontURL:       { type: 'text', max: 2000, group: 'font', sanitize: 'fontURL' },
	FontSource:    { type: 'object', shape: 'fontSource', group: 'font' },
	PreviewText:   { type: 'text', max: 40, group: 'font' },
	Theme:         { type: 'enum', values: ['light', 'dark', 'system'], group: 'appearance' },
	ResourceMode:  { type: 'enum', values: ['cdn', 'local'], group: 'resource' }
};

/*
 * 桌面端偏好键：与 Go internal/domain.Config 字段一一对应（DefaultPort / BindAddr 由内核管理，不在前端 Schema）。
 * 桌面端这部分以 Go 配置服务为 SSOT（PUT /api/config），其余内容 / UI 字段仍走 localStorage。
 */
export const PREFS_KEYS = [
	'Theme', 'Template', 'ZgType', 'InkColor', 'InkAlpha', 'FontWeight',
	'fontURL', 'FontSource', 'ResourceMode', 'Page', 'Margin'
];

/* 摘出偏好子集（供 IPC setConfig 传输） */
export const pickPrefs = (cfg) => {
	var out = {};
	PREFS_KEYS.forEach(function (k) { out[k] = cfg[k]; });
	return out;
};

/* 按 Schema 归一化单个字段（load / 设置层共用） */
export const normalizeField = (key, value) => {
	const spec = ConfigSchema[key];
	if (!spec) return value;
	const fallback = DEFAULTS[key];
	switch (spec.type) {
		case 'text': {
			if (typeof value !== 'string') return fallback;
			const text = value.slice(0, spec.max || undefined);
			return spec.sanitize === 'fontURL' ? sanitizeFontURL(text) : text;
		}
		case 'enum':
			return normalize(value, spec.values, fallback);
		case 'int':
			return normalizeInt(value, spec.min, spec.max, fallback);
		case 'percent':
			return normalizeFloat(value, spec.min, spec.max, fallback);
		case 'hex':
			return sanitizeHexColor(value);
		case 'bool':
			return typeof value === 'boolean' ? value : fallback;
		case 'object': {
			/* 字体来源有专属结构（default / url / local），单独归一化 */
			if (spec.shape === 'fontSource') return normalizeFontSource(value, fallback);
			/* 各字帖类型的独立记忆（content + 版式快照） */
			if (spec.shape === 'modeStates') return normalizeModeStates(value);
			/* 结构对象（Page/Margin）：按 fallback 的键逐一校验数字，避免脏结构 */
			if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
			const out = {};
			Object.keys(fallback || {}).forEach((k) => {
				const n = Number(value[k]);
				out[k] = Number.isFinite(n) ? n : fallback[k];
			});
			return out;
		}
		default:
			return fallback;
	}
};

/* 字体格式识别（完整版与精简版共用） */
export const guessFontFormat = (url) => {
	const match = String(url || '').match(/\.(woff2?|ttf|otf|eot)(?:[?#]|$)/i);
	return match ? (FONT_FORMATS[match[1].toLowerCase()] || 'truetype') : 'truetype';
};

/* 字体来源归一化：default（系统默认）/ url（网络地址，消毒）/ local（本地字体 id） */
export const normalizeFontSource = (value, fallback) => {
	const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	if (v.type === 'url') {
		const url = sanitizeFontURL(v.url);
		return url ? { type: 'url', url } : fallback;
	}
	if (v.type === 'local' && /^[A-Za-z0-9._-]{1,64}$/.test(String(v.id))) {
		return { type: 'local', id: String(v.id) };
	}
	/* 系统字体：名称白名单防 CSS 注入（font.js 侧还会做字符串转义） */
	if (v.type === 'system' && typeof v.name === 'string' &&
		/^[^'"\\{};]{1,80}$/.test(v.name.trim())) {
		return { type: 'system', name: v.name.trim() };
	}
	return fallback;
};

/* 仅接受 http(s) 地址或相对路径（同源），避免 CSS 注入；base64 data URL 不支持 */
export const sanitizeFontURL = (url) => {
	const trimmed = String(url || '').trim();
	if (!trimmed) return '';
	if (/^https?:\/\/[^\s"'()]+$/i.test(trimmed)) return trimmed;
	if (/^[a-zA-Z0-9._~/-]+$/.test(trimmed)) return trimmed; /* 相对路径，如 font/5.woff */
	return '';
};

/* 字格颜色消毒：只接受 #rrggbb（小写归一）；其余（含空）回退预设色 */
export const sanitizeHexColor = (value) => {
	const v = String(value == null ? '' : value).trim().toLowerCase();
	return /^#[0-9a-f]{6}$/.test(v) ? v : '';
};

/* 数值区间收敛：0 / 非法 / 空 → fallback */
const clampNumber = (value, min, max, fallback) => {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.min(max, Math.max(min, n));
};

/*
 * 字格绘制参数：配置 → opts 的唯一转换点（面板缩略图 / 预览 / PDF 共用）。
 * 旧配置（无 ZgLineColor 等新字段）按 ZgColor 预设派生，渲染结果与旧版一致。
 * borderScale 输出绝对百分比 ×100（0 = 自动 → 拼音格 100 / 其余 200）。
 */
export const resolveZgOptions = (cfg) => {
	const c = cfg || {};
	const type = normalize(c.ZgType, ZG_TYPES, DEFAULTS.ZgType);
	const presetKey = normalize(c.ZgColor, ZG_COLORS, DEFAULTS.ZgColor);
	const preset = ZG_COLOR_VALUES[presetKey] || ZG_COLOR_VALUES[DEFAULTS.ZgColor];
	return {
		type,
		lineColor: sanitizeHexColor(c.ZgLineColor) || preset.line,
		borderColor: sanitizeHexColor(c.ZgBorderColor) || preset.border,
		innerMode: normalize(c.ZgInnerLineMode, ZG_LINE_MODES, DEFAULTS.ZgInnerLineMode),
		borderMode: normalize(c.ZgLineMode, ZG_LINE_MODES, DEFAULTS.ZgLineMode),
		/* 配置存 ×100，收敛为倍数（0 / 非法 / 空 → fallback） */
		lineScale: clampNumber(c.ZgLineScale / 100, 0.25, 3, 1),
		borderScale: c.ZgBorderScale > 0
			? clampNumber(c.ZgBorderScale / 100, 0.5, 3, 1)
			: (type === '5' ? 1 : 2),
		innerRatio: clampNumber(c.ZgInnerRatio, MIN_ZG_INNER_RATIO, MAX_ZG_INNER_RATIO, DEFAULTS.ZgInnerRatio),
		engMid: clampNumber(c.ZgEngMid, MIN_ZG_ENG_MID, MAX_ZG_ENG_MID, DEFAULTS.ZgEngMid),
		pinyinTop: clampNumber(c.ZgPinyinTop, MIN_ZG_PINYIN_TOP, MAX_ZG_PINYIN_TOP, DEFAULTS.ZgPinyinTop),
		baselinePos: clampNumber(c.ZgBaselinePos, MIN_ZG_BASELINE_POS, MAX_ZG_BASELINE_POS, DEFAULTS.ZgBaselinePos),
		startDot: c.ZgStartDot === true,
		lineCap: normalize(c.ZgLineCap, ZG_LINE_CAPS, DEFAULTS.ZgLineCap),
		crisp: c.ZgCrisp === true,
		opacity: clampNumber(c.ZgOpacity / 100, 0.1, 1, 1),
		dashStyle: normalize(c.ZgDashStyle, ZG_DASH_STYLES, DEFAULTS.ZgDashStyle),
		dashDensity: clampNumber(c.ZgDashDensity / 100, 0.25, 2, 1)
	};
};

/*
 * 读取配置：每次返回全新对象（默认值 + 盘上快照，按 Schema 归一化）。
 * 旧键 zitie-lite.config 迁移到统一键后删除旧键；localStorage 不可用时静默用默认。
 */
export const loadConfig = () => {
	const cfg = {};
	Object.keys(ConfigSchema).forEach((key) => { cfg[key] = DEFAULTS[key]; });
	try {
		let raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw && LEGACY_STORAGE_KEY) {
			const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
			if (legacy) {
				raw = legacy;
				try { window.localStorage.setItem(STORAGE_KEY, legacy); } catch { /* 忽略 */ }
				try { window.localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* 忽略 */ }
			}
		}
		const saved = raw ? JSON.parse(raw) : {};
		/* 统一按 Schema 归一化（Content/Title 超长会被截断） */
		Object.keys(ConfigSchema).forEach((key) => {
			cfg[key] = normalizeField(key, saved[key]);
		});
		/* 旧版「描红模式」映射为模板（仅当未显式保存过模板时） */
		if (saved.Template == null && saved.TraceMode === true) cfg.Template = 'trace';
		/* 旧版 fontURL 字段迁移为 FontSource（仅当未显式保存过来源时） */
		if (saved.FontSource == null && cfg.fontURL) {
			cfg.FontSource = { type: 'url', url: cfg.fontURL };
		}
	} catch {
		/* localStorage 不可用（隐私模式等）时静默降级为默认配置 */
	}
	return cfg;
};

/* 落盘：只写 Schema 白名单字段（写入失败时忽略） */
export const saveConfig = (cfg) => {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotConfig(cfg)));
	} catch {
		/* 写入失败（配额/禁用）时忽略 */
	}
};

/* 白名单快照（导出 JSON / 保存预设共用） */
export const snapshotConfig = (cfg) => {
	const data = {};
	Object.keys(ConfigSchema).forEach((key) => { data[key] = cfg[key]; });
	return data;
};

/* 具名预设：只读写字首选项，不参与配置持久化 */
export const loadPresets = () => {
	try { return JSON.parse(window.localStorage.getItem(PRESETS_KEY)) || {}; }
	catch { return {}; }
};
export const savePreset = (name, data) => {
	const all = loadPresets();
	all[name] = data;
	try { window.localStorage.setItem(PRESETS_KEY, JSON.stringify(all)); } catch { /* 忽略 */ }
	return all;
};
export const deletePreset = (name) => {
	const all = loadPresets();
	delete all[name];
	try { window.localStorage.setItem(PRESETS_KEY, JSON.stringify(all)); } catch { /* 忽略 */ }
	return all;
};
/* 重命名：保持原键顺序；新名为空 / 重名时原样返回（不覆盖） */
export const renamePreset = (oldName, newName) => {
	const all = loadPresets();
	const next = String(newName == null ? '' : newName).trim();
	if (!next || next === oldName || !all[oldName] || all[next]) return all;
	const out = {};
	Object.keys(all).forEach((k) => { out[k === oldName ? next : k] = all[k]; });
	try { window.localStorage.setItem(PRESETS_KEY, JSON.stringify(out)); } catch { /* 忽略 */ }
	return out;
};
