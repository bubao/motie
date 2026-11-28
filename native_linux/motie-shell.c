/* motie Linux 壳（GTK3 + WebKit2GTK）
 *
 * 职责与 macOS 壳（native_macos/main.swift）对齐（见 doc/desktop-architecture.md §6）：
 *   - 单窗口加载内核地址；标题「墨帖」、约 1180×860、居中
 *   - UA application name = "motie-desktop"（经 webkit_settings_set_user_agent_with_application_details 追加）
 *   - 加载失败自动重试（≤60 次 / 800ms），超限给出 GTK 提示（重试 / 退出）
 *   - 导航策略：仅本机（127.0.0.1 / localhost / [::1]）与 about: / data: / file: 在窗口内打开；
 *     其余外链交系统浏览器（xdg-open）；window.open（create 信号）同规则
 *   - 关闭窗口 = 退出壳进程（与 mac 的「关窗隐藏常驻」不同：Linux 无托盘，
 *     内核服务为独立进程，不受壳退出影响——见 doc/native-shells.md）
 *
 * 未验证声明：本文件在本机（macOS）无法编译或运行；首次目标机构建 / 运行如有问题以
 * gi-docgen 文档为准并回填此处。已知未实现：alert / confirm / prompt 的原生桥接
 * （WebKit2GTK 默认行为，验证后按需补齐）。
 *
 * 本机已对照 WebKit2GTK stable（API 4.1 / 库 2.42.5）gi-docgen 复核（2026-11-27）：
 *   - decide-policy / load-failed 信号声明均返回 gboolean，回调已按声明返回；
 *   - create 信号返回 GtkWidget*（返回 NULL 表示不新建窗口）；
 *   - UA setter 由已不在 stable 的 webkit_settings_set_application_name_for_user_agent
 *     改为官方等价物 webkit_settings_set_user_agent_with_application_details。
 *
 * 构建（目标机）：native_linux/build-linux-shell.sh（或直接 gcc，见该脚本）
 */

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>

#include <string.h>

#define DEFAULT_URL "http://127.0.0.1:39130/"
#define MAX_RETRIES 60
#define RETRY_MS 800
#define APP_NAME "墨帖"

static int retry_count = 0;
static WebKitWebView *main_view = NULL;

/* 本机地址判断：http(s)://127.0.0.1[:port] / localhost / [::1]，以及 about:/data:/file:。 */
static gboolean is_local_uri(const char *uri) {
	if (!uri) return FALSE;
	if (strncmp(uri, "about:", 6) == 0 || strncmp(uri, "data:", 5) == 0 ||
	    strncmp(uri, "file:", 5) == 0) {
		return TRUE;
	}
	const char *p = strstr(uri, "://");
	if (!p) return FALSE;
	p += 3;
	if (strncmp(p, "127.0.0.1", 9) == 0) return TRUE;
	if (strncmp(p, "localhost", 9) == 0) return TRUE;
	if (strncmp(p, "[::1]", 5) == 0) return TRUE;
	return FALSE;
}

/* 外链交系统浏览器；失败仅告警，不影响窗口内导航。 */
static void open_external(const char *uri) {
	gchar *argv[] = { "xdg-open", (gchar *)uri, NULL };
	GError *err = NULL;
	if (!g_spawn_async(NULL, argv, NULL, G_SPAWN_SEARCH_PATH, NULL, NULL, NULL, &err)) {
		g_warning("motie-shell: 打开系统浏览器失败：%s", err ? err->message : "未知错误");
		g_clear_error(&err);
	}
}

/* decide-policy：主框架导航。新窗口动作（NEW_WINDOW_ACTION）交给 create 信号，避免重复处理。
 * 信号返回 gboolean（stable 声明）：TRUE = 已决策、停止后续 handler；FALSE = 未决策，
 * 交由默认 handler（webkit_policy_decision_use）放行窗口内导航。 */
static gboolean on_decide_policy(WebKitWebView *view, WebKitPolicyDecision *decision,
				WebKitPolicyDecisionType type, gpointer user_data) {
	if (type != WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION) return FALSE;
	WebKitURIRequest *req =
		webkit_navigation_policy_decision_get_request(WEBKIT_NAVIGATION_POLICY_DECISION(decision));
	const char *uri = req ? webkit_uri_request_get_uri(req) : NULL;
	if (!uri) { /* 无 URI 的导航决策直接忽略，交由默认流程收尾 */
		webkit_policy_decision_ignore(decision);
		return TRUE;
	}
	if (is_local_uri(uri)) return FALSE; /* 不干预：默认 handler use() 放行 */
	webkit_policy_decision_ignore(decision);
	open_external(uri);
	return TRUE;
}

/* create（window.open）：本地地址复用当前视图；其余外链交系统浏览器。返回 NULL（不新建窗口）。 */
static GtkWidget *on_create(WebKitWebView *view, WebKitNavigationAction *action,
			    gpointer user_data) {
	WebKitURIRequest *req = webkit_navigation_action_get_request(action);
	const char *uri = req ? webkit_uri_request_get_uri(req) : NULL;
	if (!uri) return NULL;
	if (is_local_uri(uri)) {
		webkit_web_view_load_uri(view, uri);
	} else {
		open_external(uri);
	}
	return NULL;
}

static gboolean on_retry(gpointer user_data) {
	if (main_view) webkit_web_view_reload(main_view);
	return G_SOURCE_REMOVE;
}

/* 超限提示：模态对话框（GTK 主循环内嵌套 run），重试清零计数并刷新，退出则结束壳。 */
static void show_connect_failed_dialog(GtkWindow *parent) {
	GtkWidget *dlg = gtk_message_dialog_new(parent, GTK_DIALOG_MODAL,
						GTK_MESSAGE_WARNING, GTK_BUTTONS_NONE,
						"无法连接 motie 服务");
	gtk_message_dialog_format_secondary_text(GTK_MESSAGE_DIALOG(dlg),
						  "多次尝试仍无法加载页面。\n请确认 Go 内核正在运行后重试。");
	gtk_dialog_add_button(GTK_DIALOG(dlg), "重试", GTK_RESPONSE_ACCEPT);
	gtk_dialog_add_button(GTK_DIALOG(dlg), "退出", GTK_RESPONSE_REJECT);
	gint r = gtk_dialog_run(GTK_DIALOG(dlg));
	gtk_widget_destroy(dlg);
	if (r == GTK_RESPONSE_ACCEPT) {
		retry_count = 0;
		if (main_view) webkit_web_view_reload(main_view);
	} else {
		gtk_main_quit();
	}
}

/* load-failed：按上限重试；超限转原生提示。导航取消类失败不计入重试。
 * 信号返回 gboolean（stable 声明）：返回 TRUE 表示已接管失败处理，
 * 阻止 WebKit 默认错误页在重试间隔内闪现。 */
static gboolean on_load_failed(WebKitWebView *view, WebKitLoadEvent load_event,
			       const gchar *failing_uri, GError *error, gpointer user_data) {
	(void)load_event;
	(void)failing_uri;
	(void)error;
	if (retry_count >= MAX_RETRIES) {
		GtkWidget *parent = gtk_widget_get_toplevel(GTK_WIDGET(view));
		show_connect_failed_dialog(GTK_WINDOW(parent));
		return TRUE;
	}
	retry_count++;
	g_timeout_add(RETRY_MS, on_retry, view);
	return TRUE;
}

int main(int argc, char **argv) {
	gtk_init(&argc, &argv);

	/* 服务地址：启动参数（最后一个 http/https 参数）> MOTIE_SERVER_URL > 内置默认。 */
	const char *url = DEFAULT_URL;
	for (int i = argc - 1; i >= 1; i--) {
		if (strncmp(argv[i], "http://", 7) == 0 || strncmp(argv[i], "https://", 8) == 0) {
			url = argv[i];
			break;
		}
	}
	const char *env = g_getenv("MOTIE_SERVER_URL");
	if (env && (strncmp(env, "http://", 7) == 0 || strncmp(env, "https://", 8) == 0)) {
		url = env;
	}

	GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
	gtk_window_set_title(GTK_WINDOW(window), APP_NAME);
	gtk_window_set_default_size(GTK_WINDOW(window), 1180, 860);
	gtk_window_set_position(GTK_WINDOW(window), GTK_WIN_POS_CENTER);
	g_signal_connect(window, "destroy", G_CALLBACK(gtk_main_quit), NULL);

	main_view = WEBKIT_WEB_VIEW(webkit_web_view_new());
	WebKitSettings *settings = webkit_web_view_get_settings(main_view);
	/* stable 已无 set_application_name_for_user_agent；此 API 向默认 UA 追加应用名。 */
	webkit_settings_set_user_agent_with_application_details(settings, "motie-desktop", NULL);

	g_signal_connect(main_view, "decide-policy", G_CALLBACK(on_decide_policy), NULL);
	g_signal_connect(main_view, "create", G_CALLBACK(on_create), NULL);
	g_signal_connect(main_view, "load-failed", G_CALLBACK(on_load_failed), NULL);

	/* WebKitWebView 自身管理滚动与渲染，直接作为窗口内容。 */
	gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(main_view));

	webkit_web_view_load_uri(main_view, url);
	gtk_widget_show_all(window);
	gtk_main();
	return 0;
}
