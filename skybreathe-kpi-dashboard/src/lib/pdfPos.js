import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
import pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Returns:
 * {
 *   pages: [
 *     {
 *       pageNumber,
 *       width,
 *       height,
 *       items: [{ text, x, y, w, h }]
 *     }
 *   ]
 * }
 *
 * Coordinate system:
 * - x increases left -> right
 * - y increases top -> bottom (we convert from PDF coordinates)
 */
export async function extractPdfLayout(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const pages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });

    const content = await page.getTextContent();

    const items = content.items.map((it) => {
      // it.transform = [a,b,c,d,e,f]
      // e,f are x,y in PDF coordinate system (origin bottom-left)
      const x = it.transform[4];
      const yFromBottom = it.transform[5];
      const y = viewport.height - yFromBottom; // convert to top-left origin

      const w = it.width || 0;
      const h = it.height || 0;

      return {
        text: (it.str || "").trim(),
        x,
        y,
        w,
        h,
      };
    }).filter(i => i.text.length);

    pages.push({
      pageNumber: pageNum,
      width: viewport.width,
      height: viewport.height,
      items,
    });
  }

  return { pages };
}

/**
 * Render a page to a canvas (for debug overlay).
 */
export async function renderPdfPageToCanvas(file, pageNumber, scale = 1.2) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;

  return { canvas, width: viewport.width, height: viewport.height, scale };
}
