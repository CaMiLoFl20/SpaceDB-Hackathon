export type NewsKind =
  | 'institutional'
  | 'desk'
  | 'split'
  | 'key_article'
  | 'manual'
  | 'welcome';

export function resolveNewsKind(
  newsKind: unknown,
  headline: string
): NewsKind | undefined {
  if (/^AI Market Mover:/i.test(headline)) return 'institutional';
  if (typeof newsKind === 'string' && newsKind.length > 0) {
    return newsKind as NewsKind;
  }
  return undefined;
}

export function newsKindLabel(kind: NewsKind | undefined): string | undefined {
  switch (kind) {
    case 'institutional':
      return 'Market flow';
    case 'desk':
      return 'News desk';
    case 'split':
      return 'Corporate action';
    case 'key_article':
      return 'Key article';
    case 'manual':
      return 'Headline';
    case 'welcome':
      return 'Welcome';
    default:
      return undefined;
  }
}

export function newsKindClass(kind: NewsKind | undefined): string {
  switch (kind) {
    case 'institutional':
      return 'news-badge--flow';
    case 'split':
      return 'news-badge--split';
    case 'key_article':
      return 'news-badge--key';
    case 'desk':
    case 'manual':
      return 'news-badge--desk';
    default:
      return 'news-badge--neutral';
  }
}

export function formatFlowBehavior(behavior: string): string {
  return behavior.replace(/_/g, ' ');
}

export function displayNewsHeadline(headline: string): string {
  return headline.replace(/^AI Market Mover:\s*/i, '');
}
