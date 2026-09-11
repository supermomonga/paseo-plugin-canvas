import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { Button, CodeBlock, useRpcQuery } from "paseo-plugin-helper/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { readImage, renderGraphic, type GraphicInput } from "../shared/media";

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
  const image = result.data;
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
          accessibilityLabel={`Failed to render math. Retry: ${input.source}`}
        >
          Failed to render math (retry)
        </Text>
      );
    if (!image)
      return (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          Rendering math…
        </Text>
      );
    return (
      <Image
        source={{ uri: image.uri }}
        accessibilityLabel={`Math: ${input.source}`}
        style={{
          width: Math.min(image.width, width),
          height: image.height * Math.min(1, width / image.width),
        }}
      />
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {image ? (
        <ScrollView horizontal>
          <Image
            source={{ uri: image.uri }}
            accessibilityLabel={`Math: ${input.source}`}
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
            ? `Failed to render: ${result.error.message}`
            : "Rendering…"}
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          variant="secondary"
          size="sm"
          label="Show source"
          icon="Code"
          onPress={() => setOpen(true)}
        />
        {result.error && (
          <Button
            variant="secondary"
            size="sm"
            label="Retry"
            icon="RefreshCw"
            onPress={() => {
              void result.refetch();
            }}
          />
        )}
      </View>
      <Modal title={"Math source"} open={open} onOpenChange={setOpen}>
        <Modal.Content>
          <CodeBlock code={input.source} language={"latex"} copyable={false} />
        </Modal.Content>
      </Modal>
    </View>
  );
}
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
  const remote = /^https?:\/\//i.test(src);
  const local = !/^[a-z][\w+.-]*:|^\/\//i.test(src);
  const result = useRpcQuery(
    readImage,
    { workspaceId: workspaceId ?? "unavailable", src },
    { enabled: local && !!workspaceId, retry: false, staleTime: Infinity },
  );
  const uri = remote ? src : result.data?.uri;
  const [size, setSize] = useState<{
    uri: string;
    attempt: number;
    width: number;
    height: number;
  }>();
  const [failed, setFailed] = useState<{ uri: string; attempt: number }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!uri) return;
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
  }, [uri, attempt]);
  const error =
    (failed && failed.uri === uri && failed.attempt === attempt) ||
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
      >{`Unable to display image: ${alt || src} (retry)`}</Text>
    );
  if (!uri || !size || size.uri !== uri || size.attempt !== attempt)
    return (
      <Text style={{ color: theme.colors.foregroundMuted }}>
        Loading image…
      </Text>
    );
  const scale = Math.min(1, width / size.width);
  const image = (
    <Image
      key={`${src}:${attempt}`}
      source={{ uri }}
      accessibilityLabel={alt || "Image"}
      resizeMode="contain"
      onError={() => setFailed({ uri, attempt })}
      style={{ width: size.width * scale, height: size.height * scale }}
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
