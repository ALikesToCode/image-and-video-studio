import assert from "node:assert/strict";
import test from "node:test";

import {
  PDF_TTS_MAX_CHARS,
  buildPdfTtsText,
  isSupportedPdfFile,
} from "./pdf-text";

test("PDF file detection accepts browser PDFs and PDF filenames", () => {
  assert.equal(isSupportedPdfFile({ name: "lesson.pdf", type: "application/pdf", size: 42 }), true);
  assert.equal(isSupportedPdfFile({ name: "SCANNED.PDF", type: "", size: 42 }), true);
  assert.equal(isSupportedPdfFile({ name: "notes.txt", type: "text/plain", size: 42 }), false);
});

test("PDF TTS text keeps page breaks and trims to the speech limit", () => {
  const result = buildPdfTtsText(
    [
      "  Page one title\n\n\nFirst paragraph.  ",
      "Second page sentence.",
      "x".repeat(PDF_TTS_MAX_CHARS),
    ],
    { maxChars: 80 }
  );

  assert.equal(
    result.text,
    "Page one title\n\nFirst paragraph.\n\nSecond page sentence.\n\nxxxxxxxxxxxxxxxxxxxxxxx"
  );
  assert.equal(result.charCount, 80);
  assert.equal(result.truncatedByChars, true);
});
