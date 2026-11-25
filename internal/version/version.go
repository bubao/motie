// Package version 提供构建信息；与 package.json 的 version 同名同值
// （一致性由 TestMatchesPackageJSON 守护），main 通过 -X main.Version 注入。
package version

const Version = "0.0.1"
