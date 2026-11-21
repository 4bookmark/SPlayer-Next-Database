# 验证记录（2026-11-21）

- 基础源码：`5ac9a8eb9b5cd73a170fbe584786fbcba40274da`，工作树保留补丁和新增测试，未创建提交。
- 工具链：本机 Go 1.26.2，使用 `GOPROXY=https://goproxy.cn` 成功下载并运行项目要求的 Go 1.27.0，依赖下载成功。
- 测试先行：首次新增安全 / HTTP 测试运行因功能尚不存在而失败；实现后通过。性能回归测试先发现音频文件被打开、枚举完整解码的问题，修正为扩展名筛选及有界头部探测后通过。
- 原生针对性测试：`go test ./server/ctrlsubsonic -run TestAlbumArtwork -count=1` 通过。
- 全控制器套件：`go test ./server/ctrlsubsonic/... -count=1` 在本机 macOS 出现 `audio/x-flac` 与黄金文件 `audio/flac` 的平台 MIME 差异。通过 Go overlay 恢复全部上游源码、移除新增功能后，原始上游同样出现 39 个失败测试函数 / 子测试，证明是既有环境问题。
- 使用仅在本地验证中生效的测试文件 overlay 注册 `.flac → audio/flac` 后，全控制器及其子包测试通过。产品源码、上游黄金文件和提交补丁未修改 MIME 行为。Docker builder 安装 `shared-mime-info` 提供 Linux MIME 数据库，但本机没有 Docker，镜像内测试未实际执行。
- `CGO_ENABLED=0 go build ./cmd/gonic` 在 macOS 成功。Linux amd64 / arm64 通过 Go 交叉编译，二进制附在交付目录（不加入客户端 Git 仓库）。NAS 未运行这些程序。
- 未访问或修改 NAS；未部署容器；未声称已验证真实 NAS 端点。部署前需备份原数据库和配置，核对镜像修订、架构、可执行路径与所有卷 / 环境设置。
