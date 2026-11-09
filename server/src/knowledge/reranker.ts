const MODEL = process.env.RERANK_MODEL ?? 'Xenova/bge-reranker-base';

type Loaded = { tokenizer: any; model: any };
let loaded: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loaded ??= import('@huggingface/transformers').then(async ({ AutoTokenizer, AutoModelForSequenceClassification }) => ({
    tokenizer: await AutoTokenizer.from_pretrained(MODEL),
    model: await AutoModelForSequenceClassification.from_pretrained(MODEL, { dtype: 'q8' }),
  }));
  return loaded;
}

export async function rerankScores(question: string, passages: string[]): Promise<number[]> {
  if (!passages.length) return [];
  const { tokenizer, model } = await load();
  const inputs = tokenizer(new Array(passages.length).fill(question), {
    text_pair: passages,
    padding: true,
    truncation: true,
  });
  const { logits } = await model(inputs);
  return (logits.tolist() as number[][]).map((row) => row[0]);
}
