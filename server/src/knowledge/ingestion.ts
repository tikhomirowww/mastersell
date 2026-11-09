const HIDDEN_STYLE = /(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*[01](px)?\b|color\s*:\s*(#fff(fff)?|white)\b|opacity\s*:\s*0(\.0+)?\b)/i;
const NOISE_BLOCKS = /<(script|style|nav|footer|header|noscript)[\s\S]*?<\/\1>/gi;
const HIDDEN_ELEMENT = /<(\w+)([^>]*\bstyle\s*=\s*"[^"]*"[^>]*)>[\s\S]*?<\/\1>/gi;

const decodeEntities = (s: string) =>
  s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseHtmlNaive(html: string): string {
  return htmlToText(html);
}

export function parseHtmlClean(html: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const withoutNoise = html.replace(NOISE_BLOCKS, (block, tag) => {
    removed.push(`<${tag}> ${htmlToText(block).slice(0, 50)}`);
    return '';
  });
  const withoutHidden = withoutNoise.replace(HIDDEN_ELEMENT, (el, _tag, attrs) => {
    if (!HIDDEN_STYLE.test(attrs)) return el;
    removed.push(`скрытый текст: ${htmlToText(el).slice(0, 70)}`);
    return '';
  });
  return { text: htmlToText(withoutHidden), removed };
}
