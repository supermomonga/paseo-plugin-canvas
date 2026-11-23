import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/ui";
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
import { useText } from "./i18n";

type Translate = ReturnType<typeof useText>["t"];
type ReviewTextKey =
  | "review.errors.recipientUnavailable"
  | "review.errors.permissionPending"
  | "review.errors.interruptConfirmation"
  | "review.errors.resultUnknown"
  | "review.errors.sessionUnchecked"
  | "review.outdatedReasons.snapshot"
  | "review.outdatedReasons.limit"
  | "review.outdatedReasons.changed"
  | "review.outdatedReasons.ambiguous";

// The daemon reports these in English; known ones follow the app language.
const serverCodes: Record<string, ReviewTextKey> = {
  RECIPIENT_UNAVAILABLE: "review.errors.recipientUnavailable",
  PERMISSION_PENDING: "review.errors.permissionPending",
  INTERRUPT_CONFIRMATION: "review.errors.interruptConfirmation",
};
const serverTexts: Record<string, ReviewTextKey> = {
  "Session is no longer available in this workspace":
    "review.errors.recipientUnavailable",
  // Stored by earlier versions in delivery attempts.
  "Session is no longer available in this workspace with active Canvas MCP access":
    "review.errors.recipientUnavailable",
  "Handle this session's pending permission in Paseo before sending":
    "review.errors.permissionPending",
  "This session is running. Sending may interrupt its current work":
    "review.errors.interruptConfirmation",
  "Send result is unknown. Check the session before retrying.":
    "review.errors.resultUnknown",
  "Session could not be checked": "review.errors.sessionUnchecked",
  "The saved selection does not match its snapshot":
    "review.outdatedReasons.snapshot",
  "Tracking exceeded its computation limit": "review.outdatedReasons.limit",
  "The selected source was changed or deleted":
    "review.outdatedReasons.changed",
  "Repeated text makes the selection ambiguous":
    "review.outdatedReasons.ambiguous",
};

/** Translates a known review message from the daemon; others stay as sent. */
export function reviewServerText(t: Translate, text: string, code?: string) {
  const key = (code && serverCodes[code]) || serverTexts[text];
  return key ? t(key) : text;
}

/** The message of a failed review RPC, translated when Canvas knows it. */
export function reviewErrorText(t: Translate, error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  return reviewServerText(t, text, typeof code === "string" ? code : undefined);
}

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
  const { t } = useText();
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
        toast.show(t("review.dialog.sent"), { variant: "success" });
        onClose();
      }
    } catch (e) {
      setError(reviewErrorText(t, e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("review.dialog.title")}
      icon={<Icon name="Send" size={18} color={colors.foreground} />}
      open
      onOpenChange={(open) => {
        if (!open && !inFlight.current) onClose();
      }}
    >
      <Modal.Content>
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.foreground }}>
            {delivery
              ? t("review.dialog.requestComments")
              : t("review.dialog.selectedComments")}
          </Text>
          <Text style={{ ...metaText, color: colors.foregroundMuted }}>
            {ids
              .map((id) =>
                numbers.has(id)
                  ? t("review.dialog.commentNumber", {
                      number: numbers.get(id)!,
                    })
                  : t("review.dialog.deletedComment"),
              )
              .join(", ")}
          </Text>
        </View>
        {!ids.length && (
          <Text style={{ color: colors.statusWarning }}>
            {t("review.dialog.selectUnresolved")}
          </Text>
        )}
        {!delivery && ids.length > 50 && (
          <Text style={{ color: colors.statusWarning }}>
            {t("review.dialog.tooMany")}
          </Text>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <SettingsSelect
              label={t("review.dialog.recipient")}
              value={recipient}
              disabled={busy || !!delivery}
              options={[
                { label: t("review.dialog.selectRecipient"), value: "" },
                ...(recipients.data ?? []).map((item) => ({
                  value: item.id,
                  label:
                    item.title +
                    (item.blocked
                      ? t("review.dialog.permissionPending")
                      : item.running
                        ? t("review.dialog.running")
                        : ""),
                })),
              ]}
              onValueChange={(id) => {
                setRecipient(id);
                setInterrupt(false);
              }}
            />
          </View>
          <ToolbarButton
            icon="RefreshCw"
            accessibilityLabel={t("review.dialog.refresh")}
            onPress={() => void recipients.refetch()}
            disabled={busy || recipients.isFetching}
          />
        </View>
        {recipients.isLoading && (
          <Text style={{ color: colors.foregroundMuted }}>
            {t("review.dialog.loading")}
          </Text>
        )}
        {recipients.error && (
          <Text
            accessibilityRole="alert"
            style={{ color: colors.statusDanger }}
          >
            {reviewErrorText(t, recipients.error)}
          </Text>
        )}
        {recipients.data?.length === 0 && (
          <Text style={{ color: colors.foregroundMuted }}>
            {t("review.dialog.noRecipients")}
          </Text>
        )}
        {delivery && recipients.data && !target && (
          <Text style={{ color: colors.statusWarning }}>
            {t("review.dialog.originalUnavailable")}
          </Text>
        )}
        {target?.blocked && (
          <Text style={{ color: colors.statusWarning }}>
            {t("review.dialog.handlePermission")}
          </Text>
        )}
        {target?.running && (
          <>
            <Text style={{ color: colors.statusWarning }}>
              {t("review.dialog.mayInterrupt")}
            </Text>
            <ToolbarButton
              icon={interrupt ? "CheckSquare" : "Square"}
              label={t("review.dialog.allowInterruption")}
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
              ? t("review.dialog.unknownResult")
              : last.error
                ? reviewServerText(t, last.error)
                : last.status === "sending"
                  ? t("review.dialog.sendingRequest")
                  : t("review.dialog.notSent")}
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
                ? t("review.dialog.sending")
                : delivery
                  ? last?.status === "unknown"
                    ? t("review.retryUnknown")
                    : t("review.retryRequest")
                  : t("review.send")
            }
            variant="primary"
            disabled={disabled}
            onPress={() => void submit()}
          />
          <ToolbarButton
            icon="X"
            label={t("review.cancel")}
            disabled={busy}
            onPress={onClose}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}
