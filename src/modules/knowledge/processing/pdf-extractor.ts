import pdf from 'pdf-parse';

export async function extractTextFromPdf(
  buffer: Buffer
): Promise<{ text: string; pageCount?: number }> {
  const data = await pdf(buffer);
  // pdf-parse returns a text with page breaks as \n\f\n sometimes; keep it simple
  return { text: data.text || '', pageCount: (data as any).numpages };
}
