export const PDF_TTS_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const PDF_TTS_MAX_PAGES = 60;
export const PDF_TTS_MAX_CHARS = 12000;

export type PdfFileLike = Pick<File, "name" | "type" | "size">;

export type PdfTextBuildResult = {
  text: string;
  charCount: number;
  truncatedByChars: boolean;
};

export type PdfTextExtractionResult = PdfTextBuildResult & {
  fileName: string;
  pagesRead: number;
  totalPages: number;
  truncatedByPages: boolean;
};

type PdfJsModule = typeof import("pdfjs-dist");

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

export const isSupportedPdfFile = (file: PdfFileLike) => {
  const normalizedType = file.type.split(";")[0]?.trim().toLowerCase();
  return normalizedType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
};

export const normalizePdfExtractedText = (value: string) =>
  value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const buildPdfTtsText = (
  pages: string[],
  options: { maxChars?: number } = {}
): PdfTextBuildResult => {
  const maxChars =
    Number.isFinite(options.maxChars) && options.maxChars && options.maxChars > 0
      ? Math.trunc(options.maxChars)
      : PDF_TTS_MAX_CHARS;
  const text = pages
    .map(normalizePdfExtractedText)
    .filter(Boolean)
    .join("\n\n");
  const truncatedByChars = text.length > maxChars;
  const trimmed = (truncatedByChars ? text.slice(0, maxChars) : text).trimEnd();

  return {
    text: trimmed,
    charCount: trimmed.length,
    truncatedByChars,
  };
};

const loadPdfJs = async () => {
  pdfJsModulePromise ??= import("pdfjs-dist").then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url
      ).toString();
    }
    return pdfjs;
  });
  return await pdfJsModulePromise;
};

const readTextContentItem = (item: unknown) => {
  if (!item || typeof item !== "object") return "";
  const record = item as { str?: unknown; hasEOL?: unknown };
  if (typeof record.str !== "string") return "";
  return `${record.str}${record.hasEOL === true ? "\n" : " "}`;
};

export const extractPdfTextFromFile = async (
  file: File,
  options: { maxPages?: number; maxChars?: number; maxFileBytes?: number } = {}
): Promise<PdfTextExtractionResult> => {
  if (!isSupportedPdfFile(file)) {
    throw new Error("Select a PDF file.");
  }

  const maxFileBytes = options.maxFileBytes ?? PDF_TTS_MAX_FILE_BYTES;
  if (file.size > maxFileBytes) {
    throw new Error(`PDF is larger than ${Math.floor(maxFileBytes / 1024 / 1024)} MB.`);
  }

  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const pdf = await loadingTask.promise;

  try {
    const totalPages = pdf.numPages;
    const maxPages =
      Number.isFinite(options.maxPages) && options.maxPages && options.maxPages > 0
        ? Math.trunc(options.maxPages)
        : PDF_TTS_MAX_PAGES;
    const pageLimit = Math.min(totalPages, maxPages);
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(readTextContentItem).join("");
      pages.push(pageText);

      if (buildPdfTtsText(pages, { maxChars: options.maxChars }).truncatedByChars) {
        break;
      }
    }

    const result = buildPdfTtsText(pages, { maxChars: options.maxChars });
    if (!result.text.trim()) {
      throw new Error("No selectable text found in this PDF.");
    }

    return {
      ...result,
      fileName: file.name,
      pagesRead: pages.length,
      totalPages,
      truncatedByPages: totalPages > pages.length && !result.truncatedByChars,
    };
  } finally {
    await pdf.destroy();
  }
};
