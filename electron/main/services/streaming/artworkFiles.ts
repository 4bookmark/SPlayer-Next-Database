import fs from "node:fs/promises";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);

/**
 * 判断路径是否严格位于授权目录中
 * @param root - 真实授权目录
 * @param target - 待检查的真实路径
 * @returns 是否位于根目录内
 */
export const isWithinArtworkRoot = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    Boolean(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

/**
 * 校验图片真实路径，拒绝符号链接越界和非图片文件
 * @param root - 授权目录
 * @param file - 图片路径
 * @returns 通过校验的真实图片路径
 */
export const resolveArtworkFile = async (
  root: string,
  file: string,
): Promise<string | undefined> => {
  try {
    if (!IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) return undefined;
    const realRoot = await fs.realpath(root);
    const realFile = await fs.realpath(file);
    if (
      !isWithinArtworkRoot(realRoot, realFile) ||
      !IMAGE_EXTENSIONS.has(path.extname(realFile).toLowerCase())
    )
      return undefined;
    const stat = await fs.stat(realFile);
    return stat.isFile() && stat.size <= 32 * 1024 * 1024 ? realFile : undefined;
  } catch {
    return undefined;
  }
};

/**
 * 按主封面名称和文件名稳定排序
 * @param file - 图片文件路径
 * @returns 封面优先级
 */
const artworkRank = (file: string): number => {
  const name = path.basename(file, path.extname(file)).toLowerCase();
  return name === "cover" ? 0 : name === "folder" ? 1 : name === "front" ? 2 : 3;
};

/**
 * 按主封面优先级和大小写无关文件名比较图片
 * @param a - 第一张图片
 * @param b - 第二张图片
 * @returns 排序顺序
 */
const compareArtworkFiles = (a: string, b: string): number =>
  artworkRank(a) - artworkRank(b) ||
  path.basename(a).toLowerCase().localeCompare(path.basename(b).toLowerCase(), "en") ||
  a.localeCompare(b, "en");

/**
 * 从服务端相对歌曲路径枚举专辑图片，仅扫描歌曲所在目录，不读取子目录或父目录
 * @param root - 用户授权的只读曲库根目录
 * @param libraryPaths - 当前专辑原始歌曲相对路径
 * @param onUnavailable - 挂载或目录不可用时的通知
 * @returns 最多 64 张按优先级排列的图片真实路径
 */
export const listAlbumArtworkFiles = async (
  root: string,
  libraryPaths: string[],
  onUnavailable?: () => void,
): Promise<string[]> => {
  try {
    const realRoot = await fs.realpath(root);
    const directories = new Set<string>();
    for (const libraryPath of libraryPaths) {
      const normalized = libraryPath.replaceAll("\\", "/");
      if (
        !normalized ||
        normalized.includes("\0") ||
        path.posix.isAbsolute(normalized) ||
        /^[a-z]:/i.test(normalized) ||
        normalized.split("/").includes("..")
      )
        continue;
      const lexicalDirectory = path.dirname(path.resolve(realRoot, normalized));
      if (!isWithinArtworkRoot(realRoot, lexicalDirectory)) continue;
      try {
        const directory = await fs.realpath(lexicalDirectory);
        if (!isWithinArtworkRoot(realRoot, directory)) continue;
        if (directories.size >= 64) break;
        directories.add(directory);
      } catch {
        onUnavailable?.();
      }
    }
    if (!directories.size) onUnavailable?.();
    const files = new Set<string>();
    for (const directory of directories) {
      const entries = await fs.opendir(directory);
      for await (const entry of entries) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        const file = await resolveArtworkFile(realRoot, path.join(directory, entry.name));
        if (file) {
          files.add(file);
          if (files.size > 64) {
            const last = [...files].sort(compareArtworkFiles).pop();
            if (last) files.delete(last);
          }
        }
      }
    }
    return [...files].sort(compareArtworkFiles);
  } catch {
    onUnavailable?.();
    return [];
  }
};
