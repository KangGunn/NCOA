/**
 * 브라우저에서 PDF 파일의 글자를 읽어 줄 단위 텍스트로 만든다 (서버로 보내지 않음).
 * pdf.js는 무거우므로 이 함수를 처음 부를 때만 불러온다.
 */
export async function extractPdfText(file: File): Promise<string> {
    const [pdfjs, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
    try {
        const parts: string[] = [];
        for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
            const page = await doc.getPage(pageNo);
            const content = await page.getTextContent();
            for (const item of content.items) {
                if (!('str' in item)) continue;
                parts.push(item.str + (item.hasEOL ? '\n' : ' '));
            }
            parts.push('\n');
        }
        return parts.join('').replace(/[ \t]+/g, ' ');
    } finally {
        await doc.destroy();
    }
}
