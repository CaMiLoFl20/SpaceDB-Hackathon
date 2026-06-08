import { optionalString } from '../utils/finance';
import {
  displayNewsHeadline,
  newsKindClass,
  newsKindLabel,
  resolveNewsKind,
} from '../utils/newsKind';
import type { KeyArticleItem } from './MarketPulseStrip';

export function NewsFeed({
  news,
  keyArticle,
  affectedFunds,
  configured,
  failedMessage,
  onGenerate,
  submitting,
}: {
  news: readonly {
    id: bigint;
    headline: string;
    body: string;
    symbol: unknown;
    newsKind?: unknown;
    createdAt: { toDate: () => Date };
    isAiGenerated: boolean;
  }[];
  keyArticle?: KeyArticleItem;
  affectedFunds?: readonly string[];
  configured: boolean;
  failedMessage: string;
  onGenerate: () => void;
  submitting: boolean;
}) {
  return (
    <article className="panel">
      <div className="panel-header">
        <h2>Market signals</h2>
        {configured && (
          <button disabled={submitting} onClick={onGenerate} type="button">
            Headline
          </button>
        )}
      </div>
      <p className="muted">
        Stories are tagged by source. <strong>Market flow</strong> matches the institutional tape below;
        fund manager trades appear separately.
      </p>
      {!configured && <p className="error-text">Auto news is off. Add an OpenAI or OpenRouter key in AI Settings.</p>}
      {failedMessage && <p className="error-text">{failedMessage}</p>}
      {keyArticle && (
        <section className={`key-article-card key-article-card--${keyArticle.sentiment}`}>
          <span className="pulse-label">Key article</span>
          <strong>{keyArticle.headline}</strong>
          {affectedFunds && affectedFunds.length > 0 && (
            <p>Affected funds: {affectedFunds.join(', ')}</p>
          )}
        </section>
      )}
      {news.length === 0 ? (
        <p className="muted">No market signals yet.</p>
      ) : (
        <ul className="news-list">
          {news.map(item => {
            const symbol = optionalString(item.symbol);
            const kind = resolveNewsKind(item.newsKind, item.headline);
            const label = newsKindLabel(kind);
            return (
              <li key={item.id.toString()}>
                <div className="news-item-header">
                  {label && (
                    <span className={`news-badge ${newsKindClass(kind)}`}>{label}</span>
                  )}
                  <strong>{displayNewsHeadline(item.headline)}</strong>
                </div>
                <p>{item.body}</p>
                <time className="muted">
                  {item.createdAt.toDate().toLocaleString()}
                  {symbol ? ` · ${symbol}` : ''}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
