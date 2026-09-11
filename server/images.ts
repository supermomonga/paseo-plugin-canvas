import { open, realpath } from "node:fs/promises";
import path from "node:path";
const limit = 5_000_000;
export function imageMime(bytes: Uint8Array): string {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(b.subarray(0, 6).toString())) return "image/gif";
  if (
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  throw new Error("画像形式はPNG・JPEG・GIF・WebPに対応しています");
}
export async function workspaceImage(directory: string, src: string) {
  if (/^[a-z][\w+.-]*:|^\/\/|[\\\u0000]/i.test(src))
    throw new Error("ワークスペース内の画像パスを指定してください");
  let decoded: string;
  try {
    decoded = decodeURIComponent(src.split(/[?#]/)[0]);
  } catch {
    throw new Error("画像パスの形式が不正です");
  }
  if (decoded.includes("\0") || decoded.includes("\\"))
    throw new Error("画像パスの形式が不正です");
  const root = await realpath(directory);
  const target = await realpath(
    path.resolve(root, decoded.replace(/^\/+/, "")),
  );
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("ワークスペース外の画像は表示できません");
  const file = await open(target, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit)
      throw new Error("画像は5 MB以下の通常ファイルを指定してください");
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    for (;;) {
      const { bytesRead } = await file.read(
        buffer,
        size,
        buffer.length - size,
        null,
      );
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit) throw new Error("画像は5 MB以下にしてください");
    }
    const data = buffer.subarray(0, size);
    return { uri: `data:${imageMime(data)};base64,${data.toString("base64")}` };
  } finally {
    await file.close();
  }
}
