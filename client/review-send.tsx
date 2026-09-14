import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";
import type { PluginTheme } from "@getpaseo/plugin";
import { Button, getClientHost, useRpcQuery } from "paseo-plugin-helper/client";
import {
  getReviewRecipients,
  sendReview,
  retryReview,
  type ReviewDelivery,
  type ReviewThread,
} from "../shared/review";
import { ToolbarButton, metaText } from "./controls";

export function ReviewSendDialog({
  workspaceId,
  canvasId,
  theme,
  threads,
  numbers,
  request,
  onClose,
  onRecorded,
  onSent,
}: {
  workspaceId: string;
  canvasId: string;
  theme: PluginTheme;
  threads: ReviewThread[];
  numbers: Map<string, number>;
  request?: ReviewDelivery;
  onClose: () => void;
  onRecorded: () => void;
  onSent: (ids: string[]) => void;
}) {
  const host = getClientHost();
  const send = host.useRpc(sendReview),
    retry = host.useRpc(retryReview);
  const recipients = useRpcQuery(
    getReviewRecipients,
    { workspaceId },
    { retry: false },
  );
  const toast = useToast();
  const colors = theme.colors;
  const [delivery, setDelivery] = useState(request);
  const [recipient, setRecipient] = useState(request?.agentId ?? "");
  const [interrupt, setInterrupt] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!recipient && recipients.data?.length === 1)
      setRecipient(recipients.data[0].id);
  }, [recipients.data, recipient]);
  const target = recipients.data?.find((item) => item.id === recipient);
  const ids = delivery
    ? delivery.threads.map((item) => item.threadId)
    : threads.map((thread) => thread.id);
  const last = delivery?.attempts.at(-1);
  const disabled =
    busy ||
    !target ||
    !!recipients.error ||
    recipients.isFetching ||
    !ids.length ||
    (!delivery && ids.length > 50) ||
    target.blocked ||
    (target.running && !interrupt) ||
    last?.status === "sending";
  async function submit() {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result: ReviewDelivery = delivery
        ? await retry({
            workspaceId,
            canvasId,
            requestId: delivery.id,
            allowInterrupt: interrupt,
          })
        : await send({
            workspaceId,
            canvasId,
            agentId: recipient,
            threads: threads.map((thread) => ({
              threadId: thread.id,
              expectedRevision: thread.revision,
            })),
            allowInterrupt: interrupt,
          });
      setDelivery(result);
      onRecorded();
      if (result.attempts.at(-1)?.status === "accepted") {
        onSent(result.threads.map((item) => item.threadId));
        toast.show("Comments sent to agent", { variant: "success" });
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Send to agent"
      icon={<Icon name="Send" size={18} color={colors.foreground} />}
      open
      onOpenChange={(open) => {
        if (!open && !inFlight.current) onClose();
      }}
    >
      <Modal.Content>
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.foreground }}>
            {delivery ? "Request comments" : "Selected comments"}
          </Text>
          <Text style={{ ...metaText, color: colors.foregroundMuted }}>
            {ids
              .map((id) =>
                numbers.has(id) ? `#${numbers.get(id)}` : "Deleted comment",
              )
              .join(", ")}
          </Text>
        </View>
        {!ids.length && (
          <Text style={{ color: colors.statusWarning }}>
            Select unresolved comments before sending.
          </Text>
        )}
        {!delivery && ids.length > 50 && (
          <Text style={{ color: colors.statusWarning }}>
            Select up to 50 comments per request.
          </Text>
        )}
        <SettingsSelect
          label="Agent session"
          value={recipient}
          disabled={busy || !!delivery}
          options={[
            { label: "Select a session", value: "" },
            ...(recipients.data ?? []).map((item) => ({
              value: item.id,
              label:
                item.title +
                (item.blocked
                  ? " · Permission pending"
                  : item.running
                    ? " · Running"
                    : ""),
            })),
          ]}
          onValueChange={(id) => {
            setRecipient(id);
            setInterrupt(false);
          }}
        />
        {recipients.isLoading && (
          <Text style={{ color: colors.foregroundMuted }}>
            Loading agent sessions…
          </Text>
        )}
        {recipients.error && (
          <Text
            accessibilityRole="alert"
            style={{ color: colors.statusDanger }}
          >
            {recipients.error.message}
          </Text>
        )}
        {recipients.data?.length === 0 && (
          <Text style={{ color: colors.foregroundMuted }}>
            No sessions with Canvas MCP are available in this workspace.
          </Text>
        )}
        {delivery && recipients.data && !target && (
          <Text style={{ color: colors.statusWarning }}>
            The original agent session is unavailable. This request cannot be
            retried until it is available again.
          </Text>
        )}
        <ToolbarButton
          icon="RefreshCw"
          label="Refresh sessions"
          onPress={() => void recipients.refetch()}
          disabled={busy || recipients.isFetching}
        />
        {target?.blocked && (
          <Text style={{ color: colors.statusWarning }}>
            Handle the pending permission in Paseo before sending.
          </Text>
        )}
        {target?.running && (
          <>
            <Text style={{ color: colors.statusWarning }}>
              Sending may interrupt this session's current work.
            </Text>
            <ToolbarButton
              icon={interrupt ? "CheckSquare" : "Square"}
              label="Allow interruption"
              disabled={busy}
              onPress={() => setInterrupt(!interrupt)}
            />
          </>
        )}
        {last && last.status !== "accepted" && (
          <Text
            accessibilityRole="alert"
            style={{ color: colors.statusWarning }}
          >
            {last.status === "unknown"
              ? "Send result is unknown. Check the agent session before retrying; a retry may send twice."
              : (last.error ??
                (last.status === "sending"
                  ? "Sending request…"
                  : "The request could not be sent."))}
          </Text>
        )}
        {error && (
          <Text
            accessibilityRole="alert"
            style={{ color: colors.statusDanger }}
          >
            {error}
          </Text>
        )}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Button
            icon="Send"
            label={
              busy
                ? "Sending…"
                : delivery
                  ? last?.status === "unknown"
                    ? "Retry (may send twice)"
                    : "Retry request"
                  : "Send"
            }
            variant="primary"
            disabled={disabled}
            onPress={() => void submit()}
          />
          <ToolbarButton
            icon="X"
            label="Cancel"
            disabled={busy}
            onPress={onClose}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}
