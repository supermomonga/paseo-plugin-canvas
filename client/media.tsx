import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { Modal, ScrollView } from "@getpaseo/plugin/client/ui";
import {
  Button,
  CodeBlock,
  getClientHost,
  useRpcQuery,
} from "paseo-plugin-helper/client";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  isSvgSource,
  readImage,
  renderGraphic,
  svgSourceLimit,
  type GraphicInput,
} from "../shared/media";
import { useText } from "./i18n";

export function Graphic({
  input,
  theme,
  width,
  inline = false,
}: {
  input: GraphicInput;
  theme: PluginTheme;
  width: number;
  inline?: boolean;
}) {
  const result = useRpcQuery(renderGraphic, input, {
    retry: false,
    staleTime: Infinity,
  });
  const [open, setOpen] = useState(false);
  const { t } = useText();
  const image = result.data;
  const svg = input.kind === "svg";
  if (inline) {
    if (result.error)
      return (
        <Text
          accessibilityRole="button"
          onPress={() => {
            void result.refetch();
          }}
          style={{
            color: theme.colors.statusDanger,
            textDecorationLine: "underline",
          }}
          accessibilityLabel={t("content.math.failedLabel", {
            source: input.source,
          })}
        >
          {t("content.math.failed")}
        </Text>
      );
    if (!image)
      return (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          {t("content.math.rendering")}
        </Text>
      );
    return (
      <Image
        source={{ uri: image.uri }}
        accessibilityLabel={t("content.math.label", { source: input.source })}
        style={{
          width: Math.min(image.width, width),
          height: image.height * Math.min(1, width / image.width),
        }}
      />
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {image && svg ? (
        <Image
          source={{ uri: image.uri }}
          accessibilityLabel={t("content.svg.label")}
          style={{
            width: Math.min(image.width, width),
            height: image.height * Math.min(1, width / image.width),
          }}
        />
      ) : image ? (
        <ScrollView horizontal>
          <Image
            source={{ uri: image.uri }}
            accessibilityLabel={t("content.math.label", {
              source: input.source,
            })}
            style={{ width: image.width, height: image.height }}
          />
        </ScrollView>
      ) : (
        <Text
          accessibilityRole={result.error ? "alert" : undefined}
          style={{
            color: result.error
              ? theme.colors.statusDanger
              : theme.colors.foregroundMuted,
          }}
        >
          {result.error
            ? t("content.graphic.failed", { message: result.error.message })
            : t("content.graphic.rendering")}
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          variant="secondary"
          size="sm"
          label={t("content.graphic.showSource")}
          icon="Code"
          onPress={() => setOpen(true)}
        />
        {result.error && (
          <Button
            variant="secondary"
            size="sm"
            label={t("common.retry")}
            icon="RefreshCw"
            onPress={() => {
              void result.refetch();
            }}
          />
        )}
      </View>
      <Modal
        title={svg ? t("content.svg.source") : t("content.math.source")}
        open={open}
        onOpenChange={setOpen}
      >
        <Modal.Content>
          <CodeBlock
            code={input.source}
            language={svg ? "xml" : "latex"}
            copyable={false}
          />
        </Modal.Content>
      </Modal>
    </View>
  );
}
/** Fetches an image as SVG text from this device, as the image element would. */
async function fetchSvg(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  // Some hosts send SVG as text/plain, so only other image types are ruled out.
  if (/^image\/(?!svg)/i.test(response.headers.get("content-type") ?? ""))
    throw new Error("The image is not an SVG document");
  if (Number(response.headers.get("content-length")) > svgSourceLimit)
    throw new Error("The image must be no larger than 5 MB");
  const text = await response.text();
  if (text.length > svgSourceLimit || !isSvgSource(text))
    throw new Error("The image is not an SVG document");
  return text;
}
type SourceImage = { uri: string; width?: number; height?: number };
export function DocumentImage({
  src,
  alt,
  theme,
  width,
  workspaceId,
  inline = false,
}: {
  src: string;
  alt: string;
  theme: PluginTheme;
  width: number;
  workspaceId?: string;
  inline?: boolean;
}) {
  const { t } = useText();
  const remote = /^https?:\/\//i.test(src);
  const local = !/^[a-z][\w+.-]*:|^\/\//i.test(src);
  const result = useRpcQuery(
    readImage,
    { workspaceId: workspaceId ?? "unavailable", src },
    { enabled: local && !!workspaceId, retry: false, staleTime: Infinity },
  );
  const render = getClientHost().useRpc(renderGraphic);
  const [attempt, setAttempt] = useState(0);
  // Native clients cannot draw SVG. When a remote image does not load, this
  // device fetches it as SVG text and the daemon rasterizes it.
  const [svg, setSvg] = useState<{
    src: string;
    attempt: number;
    image?: SourceImage;
    failed?: boolean;
  }>();
  const fallback =
    remote && svg?.src === src && svg.attempt === attempt ? svg : undefined;
  const loaded: SourceImage | undefined = fallback
    ? fallback.image
    : remote
      ? { uri: src }
      : result.data;
  const uri = loaded?.uri;
  // Rasterized SVGs report their display size; other images are measured.
  const known =
    loaded?.width && loaded.height
      ? { width: loaded.width, height: loaded.height }
      : undefined;
  const [size, setSize] = useState<{
    uri: string;
    attempt: number;
    width: number;
    height: number;
  }>();
  const [failed, setFailed] = useState<{ uri: string; attempt: number }>();
  useEffect(() => {
    if (!uri || known) return;
    let active = true;
    // onLoad's event payload differs between native and react-native-web.
    // getSize is a public API supported by both hosts.
    Image.getSize(
      uri,
      (imageWidth, imageHeight) => {
        if (!active) return;
        if (!(
          imageWidth > 0 &&
          imageHeight > 0 &&
          Number.isFinite(imageWidth) &&
          Number.isFinite(imageHeight)
        )) {
          setFailed({ uri, attempt });
          return;
        }
        setSize({ uri, attempt, width: imageWidth, height: imageHeight });
      },
      () => {
        if (active) setFailed({ uri, attempt });
      },
    );
    return () => {
      active = false;
    };
  }, [uri, attempt, !!known]);
  const directFailed =
    remote && failed?.uri === src && failed.attempt === attempt;
  useEffect(() => {
    if (!directFailed) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    setSvg({ src, attempt });
    fetchSvg(src, controller.signal)
      .finally(() => clearTimeout(timer))
      .then((source) => render({ kind: "svg", source }))
      .then(
        (image) => {
          if (active) setSvg({ src, attempt, image });
        },
        () => {
          if (active) setSvg({ src, attempt, failed: true });
        },
      );
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [directFailed, src, attempt]);
  const error =
    // A remote image that fails to load directly is retried as SVG first.
    (!!uri &&
      failed?.uri === uri &&
      failed.attempt === attempt &&
      !(remote && !fallback)) ||
    !!fallback?.failed ||
    (local && result.error) ||
    (!remote && (!local || !workspaceId));
  if (error)
    return (
      <Text
        accessibilityRole="button"
        onPress={() => {
          setAttempt((n) => n + 1);
          if (local) void result.refetch();
        }}
        style={{
          color: theme.colors.statusDanger,
          textDecorationLine: "underline",
        }}
      >
        {t("content.image.failed", { name: alt || src })}
      </Text>
    );
  const measured =
    size && size.uri === uri && size.attempt === attempt ? size : undefined;
  const display = known ?? measured;
  if (!uri || !display || (directFailed && !fallback))
    return (
      <Text style={{ color: theme.colors.foregroundMuted }}>
        {t("content.image.loading")}
      </Text>
    );
  const scale = Math.min(1, width / display.width);
  const image = (
    <Image
      key={`${src}:${attempt}`}
      source={{ uri }}
      accessibilityLabel={alt || t("content.image.label")}
      resizeMode="contain"
      onError={() => setFailed({ uri, attempt })}
      style={{ width: display.width * scale, height: display.height * scale }}
    />
  );
  return inline ? (
    image
  ) : (
    <View style={{ gap: 6 }}>
      {image}
      {alt ? (
        <Text
          style={{
            color: theme.colors.foregroundMuted,
            fontSize: 12,
            lineHeight: 18,
          }}
        >
          {alt}
        </Text>
      ) : null}
    </View>
  );
}
