"use client";

import {
  useEffect,
  useState,
} from "react";

import type { ChatAttachmentAsset } from "@/lib/chat-tooling";
import {
  extractPdfTextFromFile,
  isSupportedPdfFile,
} from "@/lib/client/pdf-text";

import {
  acceptsTextFile,
  createChatId,
  fileToDataUrl,
} from "./chutes-chat-runtime";
import {
  CHAT_IMAGE_ATTACHMENT_MAX_BYTES,
  CHAT_TEXT_ATTACHMENT_MAX_BYTES,
  CHAT_TEXT_ATTACHMENT_MAX_CHARS,
  MAX_PENDING_ATTACHMENTS,
} from "./chutes-chat-types";

type UseChutesChatAttachmentsOptions = {
  supportsImageAttachments: boolean;
  supportsFileAttachments: boolean;
};

export const useChutesChatAttachments = ({
  supportsImageAttachments,
  supportsFileAttachments,
}: UseChutesChatAttachmentsOptions) => {
  const [pendingAttachments, setPendingAttachments] =
    useState<ChatAttachmentAsset[]>([]);
  const [attachmentLoading, setAttachmentLoading] =
    useState(false);
  const [attachmentError, setAttachmentError] =
    useState<string | null>(null);

  useEffect(() => {
    setPendingAttachments((previous) => {
      const next = previous.filter((attachment) =>
        attachment.kind === "image"
          ? supportsImageAttachments
          : supportsFileAttachments,
      );
      if (next.length !== previous.length) {
        setAttachmentError(
          "Removed attachments that the selected model does not advertise support for.",
        );
      }
      return next;
    });
  }, [
    supportsFileAttachments,
    supportsImageAttachments,
  ]);

  const readAttachment = async (
    file: File,
  ): Promise<ChatAttachmentAsset> => {
    if (file.type.startsWith("image/")) {
      if (!supportsImageAttachments) {
        throw new Error(
          "The selected chat model does not advertise image input support.",
        );
      }
      if (
        file.size > CHAT_IMAGE_ATTACHMENT_MAX_BYTES
      ) {
        throw new Error(
          "Image attachment is larger than 8 MB.",
        );
      }
      return {
        id: createChatId(),
        kind: "image",
        name: file.name,
        mimeType: file.type || "image/png",
        size: file.size,
        dataUrl: await fileToDataUrl(file),
      };
    }

    if (isSupportedPdfFile(file)) {
      if (!supportsFileAttachments) {
        throw new Error(
          "The selected chat model does not advertise file/PDF input support.",
        );
      }
      const result = await extractPdfTextFromFile(file, {
        maxChars: CHAT_TEXT_ATTACHMENT_MAX_CHARS,
      });
      return {
        id: createChatId(),
        kind: "pdf",
        name: result.fileName,
        mimeType:
          file.type || "application/pdf",
        size: file.size,
        text: result.text,
        pagesRead: result.pagesRead,
        totalPages: result.totalPages,
        truncated:
          result.truncatedByChars ||
          result.truncatedByPages,
      };
    }

    if (acceptsTextFile(file)) {
      if (!supportsFileAttachments) {
        throw new Error(
          "The selected chat model does not advertise file/text input support.",
        );
      }
      if (
        file.size > CHAT_TEXT_ATTACHMENT_MAX_BYTES
      ) {
        throw new Error(
          "Text attachment is larger than 2 MB.",
        );
      }
      const rawText = await file.text();
      const truncated =
        rawText.length >
        CHAT_TEXT_ATTACHMENT_MAX_CHARS;
      return {
        id: createChatId(),
        kind: "text",
        name: file.name,
        mimeType: file.type || "text/plain",
        size: file.size,
        text: rawText.slice(
          0,
          CHAT_TEXT_ATTACHMENT_MAX_CHARS,
        ),
        truncated,
      };
    }

    throw new Error(
      `${file.name} is not a supported chat attachment.`,
    );
  };

  const addAttachmentFiles = async (
    files: FileList | File[],
  ) => {
    const availableSlots =
      MAX_PENDING_ATTACHMENTS -
      pendingAttachments.length;
    if (availableSlots <= 0) {
      setAttachmentError(
        `You can attach up to ${MAX_PENDING_ATTACHMENTS} files per message.`,
      );
      return;
    }
    setAttachmentLoading(true);
    setAttachmentError(null);
    try {
      const nextFiles = Array.from(files).slice(
        0,
        availableSlots,
      );
      const results = await Promise.all(
        nextFiles.map(readAttachment),
      );
      setPendingAttachments((previous) => [
        ...previous,
        ...results,
      ]);
    } catch (error) {
      setAttachmentError(
        error instanceof Error
          ? error.message
          : "Unable to read attachment.",
      );
    } finally {
      setAttachmentLoading(false);
    }
  };

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((previous) =>
      previous.filter(
        (attachment) => attachment.id !== id,
      ),
    );
  };

  return {
    pendingAttachments,
    setPendingAttachments,
    attachmentLoading,
    attachmentError,
    setAttachmentError,
    addAttachmentFiles,
    removePendingAttachment,
  };
};
