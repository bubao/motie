// motie Windows 壳（WinForms + WebView2）
//
// 职责与 macOS 壳（native_macos/main.swift）对齐（见 doc/desktop-architecture.md §6）：
//   - 单窗口加载内核地址；标题「墨帖」、约 1180×860、屏幕居中
//   - UA 附加 application name "motie-desktop"（经 CoreWebView2Settings.UserAgent 追加）
//   - 导航策略：仅本机（127.0.0.1 / localhost / ::1）与 about:/data:/file: 在窗口内打开；
//     其余外链交系统默认浏览器；新窗口请求（window.open）同规则
//   - JS→原生桥（WebMessage，action=fullscreen/print）：
//     fullscreen 切换最大化；print 调用 PrintAsync（需较新 WebView2 Runtime，失败时明确提示）
//   - 关闭窗口 = 退出壳进程（与 mac 的关窗隐藏常驻不同：Windows 无托盘，
//     内核服务为独立进程，不受壳退出影响——见 doc/native-shells.md）
//
// 未验证声明：本文件在本机（macOS）无法编译或运行；首次目标机构建 / 运行如有问题以
// WebView2 官方文档为准并回填此处。已知缺口：alert/confirm/prompt 走 WebView2 默认弹窗
// （其行为与 mac 原生面板不完全一致），验证后按需统一。
//
// 本机已对照 Microsoft Learn / .NET 文档复核（2026-11-27）：
//   - Uri.Host 对 IPv6 返回带括号形式 "[::1]"（官方示例），IsLocalUri 已同时接受；
//   - UA 改用官方属性 CoreWebView2Settings.UserAgent 追加（原 --application-name
//     不是 Chromium/WebView2 开关）；Runtime 过旧取不到该属性时静默降级。
//
// 构建（目标机）：native_windows/build-windows-shell.ps1（或直接 dotnet publish，见该脚本）

using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;

using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MotieShell
{
    internal static class Program
    {
        private const string DefaultUrl = "http://127.0.0.1:39130/";
        private const string AppTitle = "墨帖";

        [STAThread]
        private static int Main(string[] args)
        {
            ApplicationConfiguration.Initialize();
            var form = new ShellForm(ResolveUrl(args));
            Application.Run(form);
            return 0;
        }

        // 服务地址：启动参数（最后一个 http/https 参数）> MOTIE_SERVER_URL > 内置默认。
        private static string ResolveUrl(string[] args)
        {
            for (int i = args.Length - 1; i >= 0; i--)
            {
                if (IsHttp(args[i])) return args[i];
            }
            var env = Environment.GetEnvironmentVariable("MOTIE_SERVER_URL");
            if (IsHttp(env)) return env;
            return DefaultUrl;
        }

        private static bool IsHttp(string url) =>
            !string.IsNullOrEmpty(url) &&
            (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
             url.StartsWith("https://", StringComparison.OrdinalIgnoreCase));
    }

    internal sealed class ShellForm : Form
    {
        private readonly WebView2 webView = new WebView2();

        public ShellForm(string url)
        {
            Text = AppTitle;
            ClientSize = new System.Drawing.Size(1180, 860);
            StartPosition = FormStartPosition.CenterScreen;
            webView.Dock = DockStyle.Fill;
            Controls.Add(webView);
            Load += async (_, _) => await InitializeAsync(url);
        }

        private async Task InitializeAsync(string url)
        {
            string userDataFolder = Path.Combine(AppContext.BaseDirectory, "motie-shell-data");
            Directory.CreateDirectory(userDataFolder);

            var env = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: userDataFolder);

            await webView.EnsureCoreWebView2Async(env);

            // UA 追加 "motie-desktop"（与 mac 壳 applicationNameForUserAgent 对齐）。
            // UserAgent 为官方读写属性；Runtime 过旧时取用失败则仅缺 UA 标注，不影响功能。
            try { webView.CoreWebView2.Settings.UserAgent += " motie-desktop"; }
            catch (Exception) { /* 旧 Runtime 无此属性 */ }

            webView.CoreWebView2.NavigationStarting += OnNavigationStarting;
            webView.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
            webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

            webView.CoreWebView2.Navigate(url);
        }

        private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (IsLocalUri(e.Uri)) return;
            e.Cancel = true;
            OpenExternal(e.Uri);
        }

        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            // window.open：本地复用当前窗口，外链交系统浏览器，一律不再弹原生新窗口；
            // e.Uri 为空（如 window.open() 未指定地址）时仅拦截、不动作。
            e.Handled = true;
            var uri = e.Uri;
            if (string.IsNullOrEmpty(uri)) return;
            if (IsLocalUri(uri))
            {
                webView.CoreWebView2?.Navigate(uri);
            }
            else
            {
                OpenExternal(uri);
            }
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string action = null;
            try
            {
                using var doc = JsonDocument.Parse(e.WebMessageAsJson);
                action = doc.RootElement.TryGetProperty("action", out var a) ? a.GetString() : null;
            }
            catch
            {
                // WebMessageAsJson 解析失败时尝试按字符串读取（兼容简单调用）
                action = TryParseSimpleAction(e.WebMessageAsString);
            }

            switch (action)
            {
                case "fullscreen":
                    WindowState = WindowState == FormWindowState.Maximized
                        ? FormWindowState.Normal
                        : FormWindowState.Maximized;
                    break;
                case "print":
                    _ = PrintAsync();
                    break;
            }
        }

        private static string TryParseSimpleAction(string message)
        {
            if (message == null) return null;
            var s = message.Trim().Trim('"');
            return s == "fullscreen" || s == "print" ? s : null;
        }

        private async Task PrintAsync()
        {
            try
            {
                // PrintAsync 需较新 WebView2 Runtime；旧 Runtime 可能缺失此 API
                await webView.CoreWebView2.PrintAsync(null);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "当前 WebView2 Runtime 不支持打印接口：" + ex.Message, AppTitle,
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private static bool IsLocalUri(string uri)
        {
            if (string.IsNullOrEmpty(uri)) return false;
            if (uri.StartsWith("about:", StringComparison.Ordinal) ||
                uri.StartsWith("data:", StringComparison.Ordinal) ||
                uri.StartsWith("file:", StringComparison.Ordinal)) return true;
            // Uri.Host 对 IPv6 返回带括号形式 "[::1]"（见 MS Learn Uri.Host 官方示例），故两者皆认。
            return Uri.TryCreate(uri, UriKind.Absolute, out var parsed)
                && parsed.Host is "127.0.0.1" or "localhost" or "::1" or "[::1]";
        }

        private static void OpenExternal(string uri)
        {
            try
            {
                using var psi = new ProcessStartInfo(uri) { UseShellExecute = true };
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("打开系统浏览器失败：" + ex.Message, AppTitle,
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }
}
