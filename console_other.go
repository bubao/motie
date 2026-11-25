//go:build !windows

package main

// attachParentConsole 在非 Windows 平台是空操作：进程本身即带有控制台，
// 无需附加（Windows 见 console_windows.go）。
func attachParentConsole() {}
