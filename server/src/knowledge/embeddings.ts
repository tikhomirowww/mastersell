const MODEL = 'Xenova/multilingual-e5-small';

type Extractor = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
let extractor: Promise<Extractor> | null = null;

function load(): Promise<Extractor> {
  extractor ??= import('@huggingface/transformers').then(
    ({ pipeline }) => pipeline('feature-extraction', MODEL, { dtype: 'q8' }) as unknown as Promise<Extractor>,
  );
  return extractor;
}

export async function embedPassages(texts: string[]): Promise<number[][]> {
  const fn = await load();
  return (await fn(texts.map((t) => `passage: ${t}`), { pooling: 'mean', normalize: true })).tolist();
}

export async function embedQuery(text: string): Promise<number[]> {
  const fn = await load();
  return (await fn([`query: ${text}`], { pooling: 'mean', normalize: true })).tolist()[0];
}
