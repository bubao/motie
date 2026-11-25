// motie macOS 壳（WKWebView 启动器）
//
// 职责（见 doc/desktop-architecture.md 6.1）：
//   - 独立菜单栏（关于 / 隐藏 / 退出，Cmd+Q）、Dock 点击重开、关窗隐藏而非退出
//   - 托盘常驻（状态栏）：显示主窗口 / 新建窗口 / 关于 / 退出
//   - 多窗口：文件菜单或托盘「新建窗口」（⌘N）创建；仅最后一个窗口关闭时隐藏到托盘
//   - 加载失败自动重试（≤60 次 / 800ms），超限给出原生提示
//   - alert / confirm / prompt 原生桥接
//   - 外链（非 127.0.0.1）交系统浏览器，window.open 拦截
//   - 预留 JS→原生桥 messageHandlers["motie"]：fullscreen / print
//
// 构建（打包 .app 时补 Info.plist 与图标）：
//   swiftc -O -o build/motie-shell native_macos/main.swift
//
// 服务地址来源（优先级从高到低）：
//   1. 启动参数：/usr/bin/open -n -a motie.app --args http://127.0.0.1:<port>/
//   2. 环境变量 MOTIE_SERVER_URL
//   3. 内置默认 http://127.0.0.1:39130/（与 internal/config.DefaultPort 一致）

import Cocoa
import WebKit

let defaultServerURL = URL(string: "http://127.0.0.1:39130/")!
let maxLoadRetries = 60
let retryInterval: TimeInterval = 0.8

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSWindowDelegate {

    private var windows: [NSWindow] = []
    private var statusItem: NSStatusItem?
    private let serverURL: URL
    private var retryCount = 0

    init(serverURL: URL) {
        self.serverURL = serverURL
        super.init()
    }

    // MARK: 应用生命周期

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenu()
        buildStatusItem()
        makeWindow()
        NSApp.activate(ignoringOtherApps: true)
    }

    /// 关窗隐藏而非退出：服务常驻，Dock 点击重开。
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showFront()
        return true
    }

    /// 当前操作对象：key 窗口优先，其次最后一个窗口（多窗口下不误伤其它窗口）。
    private var activeWindow: NSWindow? {
        NSApp.keyWindow ?? windows.last
    }

    private func makeWindow() {
        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false)
        win.title = "墨帖"
        win.center()
        win.delegate = self

        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = "motie-desktop"
        config.userContentController.add(self, name: "motie")

        let view = WKWebView(frame: .zero, configuration: config)
        view.uiDelegate = self
        view.navigationDelegate = self
        view.allowsBackForwardNavigationGestures = false
        win.contentView = view

        windows.append(win)
        win.makeKeyAndOrderFront(nil)
        view.load(URLRequest(url: serverURL))
    }

    func windowWillClose(_ notification: Notification) {
        if let win = notification.object as? NSWindow {
            windows.removeAll { $0 === win }
        }
        // 关最后一个窗口：隐藏到托盘（服务常驻）；仍有其它窗口则不影响
        if windows.isEmpty {
            NSApp.hide(nil)
        }
    }

    // MARK: 托盘（状态栏）

    private func buildStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            let image = NSImage(systemSymbolName: "square.grid.2x2", accessibilityDescription: "墨帖")
            image?.isTemplate = true
            button.image = image
        }
        let menu = NSMenu()
        menu.addItem(withTitle: "显示墨帖", action: #selector(AppDelegate.showFront(_:)), keyEquivalent: "")
        menu.addItem(withTitle: "新建窗口", action: #selector(AppDelegate.newWindowFromMenu), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "关于墨帖",
                        action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
                        keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出墨帖", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        item.menu = menu
        statusItem = item
    }

    @objc func showFront(_ sender: Any? = nil) {
        if windows.isEmpty {
            makeWindow()
        } else if let w = windows.first(where: { $0.isVisible }) ?? windows.last {
            w.makeKeyAndOrderFront(nil)
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func newWindowFromMenu() { makeWindow() }

    // MARK: 加载与重试

    private func loadServer() {
        retryCount = 0
        (activeWindow?.contentView as? WKWebView)?.load(URLRequest(url: serverURL))
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadError(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleLoadError(error)
    }

    private func handleLoadError(_ error: Error) {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
            return // 导航被主动取消（外链 / window.open 拦截），不算失败
        }
        guard retryCount < maxLoadRetries else {
            presentLoadFailed(error)
            return
        }
        retryCount += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + retryInterval) { [weak self] in
            (self?.activeWindow?.contentView as? WKWebView)?.reload()
        }
    }

    private func presentLoadFailed(_ error: Error) {
        let alert = NSAlert()
        alert.messageText = "无法连接 motie 服务"
        alert.informativeText = "\(error.localizedDescription)\n请确认 Go 内核正在运行后重试。"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "重试")
        alert.addButton(withTitle: "退出")
        if alert.runModal() == .alertFirstButtonReturn {
            loadServer()
        } else {
            NSApp.terminate(nil)
        }
    }

    // MARK: 导航策略

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        if isLocalURL(url) || url.scheme == "about" || url.scheme == "data" {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    /// window.open 拦截：交系统浏览器。
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    private func isLocalURL(_ url: URL) -> Bool {
        guard let host = url.host else { return false }
        return host == "127.0.0.1" || host == "localhost" || host == "::1"
    }

    // MARK: alert / confirm / prompt 原生桥接

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "好")
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        input.stringValue = defaultText ?? ""
        alert.accessoryView = input
        if alert.runModal() == .alertFirstButtonReturn {
            completionHandler(input.stringValue)
        } else {
            completionHandler(nil)
        }
    }

    // MARK: JS→原生桥（messageHandlers["motie"]）

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "motie",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        switch action {
        case "fullscreen":
            activeWindow?.toggleFullScreen(nil)
        case "print":
            /* 原生打印面板：直接打印当前 key 窗口的 WKWebView（打印 CSS 已生效，所见即所得） */
            if let view = activeWindow?.contentView as? WKWebView {
                let operation = view.printOperation(with: NSPrintInfo.shared)
                operation.showsPrintPanel = true
                operation.run()
            }
        default:
            NSLog("motie bridge: 未实现的 action=%@ body=%@", action, "\(body)")
        }
    }
}

// MARK: 菜单

extension AppDelegate {

    func buildMenu() {
        let mainMenu = NSMenu()
        NSApp.mainMenu = mainMenu

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "关于墨帖",
                        action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
                        keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏墨帖", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "退出墨帖", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let fileItem = NSMenuItem(title: "文件", action: nil, keyEquivalent: "")
        mainMenu.addItem(fileItem)
        let fileMenu = NSMenu(title: "文件")
        fileItem.submenu = fileMenu
        fileMenu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileMenu.addItem(withTitle: "新建窗口", action: #selector(AppDelegate.newWindowFromMenu), keyEquivalent: "n")

        let viewItem = NSMenuItem(title: "显示", action: nil, keyEquivalent: "")
        mainMenu.addItem(viewItem)
        let viewMenu = NSMenu(title: "显示")
        viewItem.submenu = viewMenu
        viewMenu.addItem(withTitle: "重新加载", action: #selector(AppDelegate.reloadFromMenu), keyEquivalent: "r")
        viewMenu.addItem(withTitle: "进入全屏幕", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    }

    @objc func reloadFromMenu() { loadServer() }
}

// MARK: 入口

let arguments = ProcessInfo.processInfo.arguments
var serverURL = defaultServerURL
if arguments.count > 1, let url = URL(string: arguments[arguments.count - 1]), url.scheme?.hasPrefix("http") == true {
    serverURL = url
}
if let env = ProcessInfo.processInfo.environment["MOTIE_SERVER_URL"],
   let url = URL(string: env), url.scheme?.hasPrefix("http") == true {
    serverURL = url
}

/* 顶层强引用持有 delegate（NSApplication.delegate 为 weak，防止立即释放）。 */
let appDelegate = AppDelegate(serverURL: serverURL)
let app = NSApplication.shared
app.delegate = appDelegate
app.run()
