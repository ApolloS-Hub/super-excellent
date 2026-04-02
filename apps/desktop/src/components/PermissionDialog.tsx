/**
 * S17 — Permission approval dialog
 * 
 * Shows when agent wants to use a write tool in non-bypass mode.
 * 5 permission levels:
 * - default: ask for every write operation
 * - acceptEdits: auto-approve file edits, ask for others
 * - dontAsk: deny all write operations silently
 * - bypassPermissions: approve everything (no dialog)
 * - plan: show plan but don't execute
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal, Stack, Text, Group, Button, Code, Badge, Checkbox,
  Paper, Divider,
} from "@mantine/core";

export interface PermissionRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  description: string;
  isReadOnly: boolean;
}

interface PermissionDialogProps {
  request: PermissionRequest | null;
  onApprove: (id: string, rememberChoice: boolean) => void;
  onDeny: (id: string) => void;
  onClose: () => void;
}

export function PermissionDialog({ request, onApprove, onDeny, onClose }: PermissionDialogProps) {
  const { t } = useTranslation();
  const [remember, setRemember] = useState(false);

  if (!request) return null;

  const toolColor = request.isReadOnly ? "green" : "orange";
  const inputPreview = JSON.stringify(request.input, null, 2).slice(0, 500);

  return (
    <Modal
      opened={!!request}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Text fw={700}>{t("permission.title")}</Text>
          <Badge color={toolColor} size="sm">{request.toolName}</Badge>
        </Group>
      }
      size="lg"
    >
      <Stack gap="md">
        <Text size="sm">{t("permission.description")}</Text>

        <Paper p="sm" radius="sm" bg="dark.7">
          <Text size="xs" fw={600} mb="xs">{t("permission.tool")}: {request.toolName}</Text>
          <Code block>{inputPreview}</Code>
        </Paper>

        {request.description && (
          <Text size="sm" c="dimmed">{request.description}</Text>
        )}

        <Divider />

        <Checkbox
          label={t("permission.remember")}
          checked={remember}
          onChange={(e) => setRemember(e.currentTarget.checked)}
          size="sm"
        />

        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" color="gray" onClick={() => onDeny(request.id)}>
            {t("permission.deny")}
          </Button>
          <Button color="green" onClick={() => onApprove(request.id, remember)}>
            {t("permission.approve")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/**
 * Permission Manager — handles the permission queue
 */
export class PermissionManager {
  private mode: string = "default";
  private approvedTools = new Set<string>();
  private pendingResolvers = new Map<string, {
    resolve: (approved: boolean) => void;
  }>();

  setMode(mode: string): void {
    this.mode = mode;
  }

  getMode(): string {
    return this.mode;
  }

  /**
   * Check if a tool call should be allowed.
   * Returns immediately for bypass/dontAsk modes.
   * For default/acceptEdits, creates a pending request.
   */
  async check(toolName: string, input: Record<string, unknown>, isReadOnly: boolean): Promise<boolean> {
    // Read-only tools always allowed
    if (isReadOnly) return true;

    switch (this.mode) {
      case "bypassPermissions":
        return true;
      case "dontAsk":
        return false;
      case "plan":
        return false; // Plan mode: show but don't execute
      case "acceptEdits":
        if (["Write", "Edit"].includes(toolName)) return true;
        break;
    }

    // Check if previously approved
    if (this.approvedTools.has(toolName)) return true;

    // Need user approval — create pending request
    return new Promise<boolean>((resolve) => {
      const id = `perm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.pendingResolvers.set(id, { resolve });

      // Emit event for UI to pick up
      window.dispatchEvent(new CustomEvent("permission-request", {
        detail: {
          id,
          toolName,
          input,
          isReadOnly,
          description: this.describeAction(toolName, input),
        },
      }));
    });
  }

  approve(id: string, remember: boolean): void {
    const pending = this.pendingResolvers.get(id);
    if (pending) {
      pending.resolve(true);
      this.pendingResolvers.delete(id);
    }
    if (remember) {
      // Extract tool name from the event (stored in pending)
      // For simplicity, approve is tool-agnostic here
    }
  }

  deny(id: string): void {
    const pending = this.pendingResolvers.get(id);
    if (pending) {
      pending.resolve(false);
      this.pendingResolvers.delete(id);
    }
  }

  private describeAction(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case "Bash":
        return `Execute command: ${(input.command as string)?.slice(0, 100)}`;
      case "Write":
        return `Write to file: ${input.path}`;
      case "Edit":
        return `Edit file: ${input.path}`;
      case "BrowserOpen":
        return `Open URL: ${input.url}`;
      default:
        return `Use tool: ${toolName}`;
    }
  }
}

// Singleton for the app
export const permissionManager = new PermissionManager();
