# gonic HTTP 多封面扩展部署包

本包扩展 gonic 原有 HTTP 服务与账号鉴权，不增加独立图片服务器、端口或账号。源码固定为已核对的 gonic 0.23.0：`5ac9a8eb9b5cd73a170fbe584786fbcba40274da`。补丁不改数据库结构，不写音乐目录。该固定修订是当次核对的源码快照，不能仅凭同为 0.23.0 就推断与 NAS 镜像源码完全相同；替换完整二进制前仍须备份数据库及原镜像。NAS 尚未部署；当前环境无 Docker 命令，镜像构建尚待有 Docker 的主机执行。

## 构建镜像

在有 Docker / BuildKit 的主机，将本目录作为构建上下文执行：

```sh
docker build -t local/gonic:splayer-artworks-0.23.0 .
```

默认构建当前主机架构。若构建机与 NAS 架构不同，先确认 NAS 架构，再用 `docker buildx build --platform linux/amd64 --load -t local/gonic:splayer-artworks-0.23.0 .`（仅适用于 amd64 NAS；arm64 则改成 `linux/arm64`）。构建需要访问 GitHub、Go 模块代理和 Alpine 镜像源；官方 Go 代理超时时，可加 `--build-arg GOPROXY=https://goproxy.cn`。Dockerfile 检出固定修订并检查、应用补丁，运行控制器测试后编译，不追踪上游最新版本。

## 替换现有服务镜像

1. 保留现有 compose 配置；备份当前 gonic 数据库和配置，并记录原镜像引用。不要新建空数据库或改音乐路径。
2. 复制 `compose.overlay.example.yaml` 为实际 overlay；将服务名 `gonic` 改成现有 compose 的服务名。仅合并镜像字段，沿用原服务的端口、网络、环境变量、用户 / UID / GID、重启策略与全部卷映射，尤其是数据库、缓存、播放列表、播客、音乐路径及容器内路径。
3. 音乐卷应以只读方式挂载，例如原来是 `/nas/music:/music`，则在原 compose 将该条改成 `/nas/music:/music:ro`。不要把示例路径直接加入 overlay，避免 Docker Compose 卷合并误覆盖。数据库、缓存等需要写入的原卷保留可写；如果现有 wrtag 写标签功能需要音乐写权限，此扩展本身不需要该权限，部署前确认现有业务需求。
4. 先执行 `docker compose -f compose.yaml -f artwork.overlay.yaml config`，人工检查最终配置仅发生预期镜像（及明确添加的音乐只读标记）变化。文件名应替换为实际文件名。
5. 在 NAS 已加载 / 构建上述镜像后执行 `docker compose -f compose.yaml -f artwork.overlay.yaml up -d --no-deps gonic`，将末尾服务名替换为实际服务名。不要执行删除卷的命令。
6. 使用现有地址和账号检查 `getOpenSubsonicExtensions` 出现 `splayerAlbumArtworks` 版本 1，再验证有多张图片的专辑。客户端自动探测扩展；无需新增地址或凭据。凭据不应写入本目录、shell 历史或分享的日志。

回退：移除 overlay 或恢复原镜像引用，使用同一配置、同一卷启动原服务。补丁不迁移数据库、不修改音乐文件。此部署方案只适用于核对过的 0.23.0；部署前若实际版本不同，应重新核对，避免无意升级或降级。

## 接口约定

所有请求沿用现有 Subsonic 参数与身份验证；`.view` 后缀由 gonic 外层路由按原规则处理。

- `getOpenSubsonicExtensions`：标准列表新增 `{"name":"splayerAlbumArtworks","versions":[1]}`。
- `getAlbumArtworks?id=al-N&f=json`：标准 `subsonic-response` 中返回 `albumArtworks: { artwork: [{ id, name, version }] }`；无候选返回空数组。不存在的专辑 / 不可用目录返回错误 70。
- `getAlbumArtwork?id=al-N&artworkId=<id>`：返回原图；加 `size=300` 返回最长边不超过 300px 的 PNG，不放大小图。其它 size 值返回错误 10。缺失文件 / 不在当前候选集的 ID 返回错误 70。错误沿用 Subsonic JSON/XML envelope；图片响应含正确 Content-Type、nosniff、私有缓存重验证和 ETag。

读取目录仅取数据库 `RootDir/LeftPath/RightPath` 当前层，并要求 RootDir 为现有配置的音乐根目录；不依赖音轨路径，不遍历子目录，不接受任意路径或远程 URL。拒绝文件和专辑目录中的符号链接，并使用 Go `os.Root` 将读操作限制在已打开的目录内。

优先级为 cover → folder → front（文件名主干不区分大小写），其它按文件名字母顺序，最多 64 张候选图片。只读取 .jpg、.jpeg、.png、.gif、.bmp、.webp 文件；枚举仅读取最多 1 MiB 图片头并验证格式、大小与像素，实际请求仅完整解码选中的图片，并限制全局同时最多 2 次解码。头部有效但像素数据损坏的文件可能暂时列出，图片接口会拒绝它。ID 为文件名 SHA-256，改内容不改 ID，版本取纳秒修改时间与文件大小；原图读取重新枚举并检查当前文件。每张文件不超过 32 MiB、解码不超过 40,000,000 像素；先验证配置再完整解码。当前支持 JPEG、PNG、GIF（缩略图取首帧）、BMP、WebP；TIFF、SVG、HEIC 等不会进入候选列表，以限制解码器的资源风险。

## 本地验证

补丁包含文件枚举顺序、64 张上限、损坏 / 超大 / 超像素图片、目录逃逸 / 符号链接 / 未配置根目录、真实路由未认证 / 错密码、原图与缩略图、无效 ID、文件消失、专辑不存在及扩展发现测试。Dockerfile 在构建时执行 `go test ./server/ctrlsubsonic/...`。具体本机测试结果见 `VALIDATION.md`。

## 使用预编译二进制

交付附件 `binaries/gonic-linux-amd64` 与 `binaries/gonic-linux-arm64` 为 `CGO_ENABLED=0` 的 Linux 二进制。它们未在 NAS 上运行；本机交叉编译成功不等于 NAS 验收成功。Unraid 通常为 amd64，仍应先确认实际架构。二进制、SHA256SUMS、源码归档与本补丁应一起保留。

为了沿用 NAS 现有镜像里的 ffmpeg、证书、用户、环境、入口脚本与依赖，可将所需二进制复制到一个临时构建目录，重命名为 `gonic`，连同 `Dockerfile.binary` 放入目录。通过 Docker inspect 获取现有镜像的准确引用（优先 digest），再执行以下命令，将示例引用替换成实际值：

```sh
docker build -f Dockerfile.binary --build-arg BASE_IMAGE='existing-image@sha256:actual-digest' -t local/gonic:splayer-artworks-0.23.0 .
```

已核对固定源码自带的 Dockerfile 中可执行文件路径为 `/usr/local/bin/gonic`。如果 NAS 镜像不是由同一 Dockerfile 构建，应先检查容器实际可执行路径。快版 Dockerfile 只替换该二进制，继承原镜像设置，不宣称任意现有镜像都兼容。

也可在现有服务配置中，将正确架构、可执行权限为 0755 的二进制以单文件只读卷挂载到核实后的可执行路径，例如 `/nas/deploy/gonic-linux-amd64:/usr/local/bin/gonic:ro`。此方式应先停止服务再替换文件并重建容器，保留全部原配置；不要复制示例宿主机路径。回退时删除该新增单文件挂载，重新使用原镜像中的程序。音乐、数据库、缓存等原卷保持不变，数据库仍须事先备份。
