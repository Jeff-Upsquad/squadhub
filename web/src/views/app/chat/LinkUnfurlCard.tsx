import type { MessageUnfurl } from '@squadhub/shared';

interface Props {
  unfurl: MessageUnfurl;
}

// Slack-style link preview card. Left accent bar + title + description +
// optional image thumbnail. Click anywhere → opens the URL in a new tab.
export default function LinkUnfurlCard({ unfurl }: Props) {
  if (!unfurl.title && !unfurl.description && !unfurl.image) return null;

  return (
    <a
      href={unfurl.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex max-w-[520px] gap-3 rounded-r-[4px] border-l-[3px] border-divider bg-surface-alt p-3 transition hover:border-l-[#1264A3] hover:bg-[rgba(18,100,163,0.06)]"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        {unfurl.site_name && (
          <p className="text-[11px] uppercase tracking-wide text-foreground-muted truncate">
            {unfurl.site_name}
          </p>
        )}
        {unfurl.title && (
          <p className="line-clamp-2 text-[14px] font-semibold leading-[18px] text-[#1264A3]">
            {unfurl.title}
          </p>
        )}
        {unfurl.description && (
          <p className="line-clamp-3 text-[13px] leading-[17px] text-foreground">
            {unfurl.description}
          </p>
        )}
      </div>
      {unfurl.image && (
        <img
          src={unfurl.image}
          alt=""
          className="h-[80px] w-[80px] shrink-0 rounded-[4px] object-cover"
          loading="lazy"
        />
      )}
    </a>
  );
}
