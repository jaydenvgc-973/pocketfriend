import React from 'react';
import { Newspaper } from 'lucide-react';

/**
 * WeeklyEditionReader — the one renderer for a The Weekly edition.
 *
 * It draws exactly the edition record it is given (masthead, headliner, sections, Around
 * Town, footer) and never fetches, generates or rewrites anything. The Weekly page and the
 * Scenes phone's News app both render this same component from the same record, so the two
 * places can never show different editions or different wording.
 *
 * `compact` adapts only the presentation for a narrower display (the phone's screen): the
 * type scale and masthead stacking change, the content does not. No section, paragraph,
 * image or caption is ever dropped to fit.
 */

export const SECTION_LABELS = {
  community_spotlight: 'Community Spotlight',
  campaign_watch: 'Campaign Watch',
  neighborhood_news: 'What\'s Happening in Your Neighborhood',
};

export function formatDateLong(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return dateStr; }
}

export function formatDateRange(start, end) {
  if (!start || !end) return '';
  try {
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    const sFmt = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const eFmt = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${sFmt} – ${eFmt}`;
  } catch { return `${start} – ${end}`; }
}

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'Inter, sans-serif';

export default function WeeklyEditionReader({ edition, compact = false, emptyNotice = null }) {
  const t = {
    masthead: compact ? 'text-3xl' : 'text-5xl',
    headlinerTitle: compact ? 'text-xl' : 'text-2xl',
    headlinerSub: compact ? 'text-sm' : 'text-base',
    headlinerBody: compact ? 'text-[13px]' : 'text-[15px]',
    pullQuote: compact ? 'text-base' : 'text-lg',
    sectionTitle: compact ? 'text-base' : 'text-lg',
    sectionBody: compact ? 'text-[13px]' : 'text-[14px]',
    brief: compact ? 'text-[13px]' : 'text-[14px]',
  };

  if (!edition) {
    return (
      <div className={`text-center ${compact ? 'py-10 px-4' : 'py-20'}`}>
        <Newspaper className={`${compact ? 'w-9 h-9' : 'w-12 h-12'} text-gray-400 mx-auto mb-4`} />
        {emptyNotice ? (
          <p className={`${compact ? 'text-sm' : 'text-base'} text-gray-600`}>{emptyNotice}</p>
        ) : (
          <>
            <h2 className="text-xl text-gray-700 mb-2">A quiet week in the world</h2>
            <p className="text-sm text-gray-500">No significant public events were recorded for this edition.</p>
          </>
        )}
      </div>
    );
  }

  if (!edition.has_sufficient_material) {
    return (
      <div className={`text-center ${compact ? 'py-10 px-4' : 'py-20'}`}>
        <Newspaper className={`${compact ? 'w-9 h-9' : 'w-12 h-12'} text-gray-400 mx-auto mb-4`} />
        <h2 className="text-xl text-gray-700 mb-2">A quiet week in the world</h2>
        <p className="text-sm text-gray-500">
          No significant public events were recorded for this edition.
          {edition?.edition_date && (
            <span className="block mt-2 text-xs">Edition #{edition.edition_number} · {formatDateLong(edition.edition_date)}</span>
          )}
        </p>
      </div>
    );
  }

  return (
    <article>
      {/* ── MASTHEAD ────────────────────────────────────────────── */}
      <header className="border-t-2 border-b-2 border-black py-4 mb-6">
        <div
          className={`flex ${compact ? 'flex-wrap gap-x-3 gap-y-1' : 'items-start justify-between'} text-[10px] tracking-widest text-gray-600 mb-2`}
          style={{ fontFamily: SANS }}
        >
          <div className="text-left">
            <div className="font-bold text-black">VOL. 1 · ISSUE {edition.edition_number || '—'}</div>
            <div className="mt-0.5">SERVING OUR COMMUNITY</div>
          </div>
          <div className={compact ? 'text-left' : 'text-center'}>
            <div className="text-[9px] tracking-widest text-gray-500">— YOUR WORLD. YOUR STORIES. —</div>
          </div>
          <div className={compact ? 'text-left' : 'text-right'}>
            <div className="font-bold text-black">EDITION #{edition.edition_number || '—'}</div>
            <div className="mt-0.5">{formatDateRange(edition.week_start, edition.week_end)}</div>
          </div>
        </div>
        <h1 className={`text-center ${t.masthead} font-bold text-black tracking-tight`} style={{ fontFamily: SERIF }}>
          The Weekly
        </h1>
        <p className="text-center text-[10px] tracking-widest text-gray-500 mt-1" style={{ fontFamily: SANS }}>
          A PUBLICATION OF THE WORLD WE SHARE
        </p>
        <div className="mt-3 pt-3 border-t border-gray-300 text-center text-xs tracking-widest text-gray-600 uppercase" style={{ fontFamily: SANS }}>
          {formatDateLong(edition.edition_date)}
        </div>
      </header>

      {/* ── HEADLINER ───────────────────────────────────────────── */}
      {edition.headliner && (
        <section className="mb-8">
          <h2 className={`${t.headlinerTitle} font-bold text-black leading-tight mb-2 uppercase`} style={{ fontFamily: SERIF }}>
            {edition.headliner.title}
          </h2>
          {edition.headliner.subtitle && (
            <p className={`${t.headlinerSub} text-gray-700 italic mb-3`} style={{ fontFamily: SERIF }}>
              {edition.headliner.subtitle}
            </p>
          )}
          <div className="text-[10px] tracking-widest text-gray-500 uppercase mb-4" style={{ fontFamily: SANS }}>
            By {edition.headliner.byline || 'Staff'} · {edition.headliner.role || 'Staff Writer'}
          </div>

          {edition.headliner.image_url && (
            <figure className="mb-4">
              <img
                src={edition.headliner.image_url}
                alt={edition.headliner.image_caption || edition.headliner.title}
                className="w-full h-auto object-cover"
              />
              {edition.headliner.image_caption && (
                <figcaption className="text-center text-xs text-gray-600 italic mt-2" style={{ fontFamily: SERIF }}>
                  {edition.headliner.image_caption}
                </figcaption>
              )}
            </figure>
          )}

          <div className={`${t.headlinerBody} text-gray-900 leading-relaxed space-y-3`} style={{ fontFamily: SERIF }}>
            {(edition.headliner.body || '').split('\n\n').map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>

          {edition.headliner.pull_quote && (
            <blockquote className={`my-5 pl-4 border-l-4 border-gray-300 ${t.pullQuote} italic text-gray-800`} style={{ fontFamily: SERIF }}>
              "{edition.headliner.pull_quote}"
            </blockquote>
          )}
        </section>
      )}

      {/* ── SECTIONS ────────────────────────────────────────────── */}
      {edition.sections?.length > 0 && (
        <section className="border-t border-gray-300 pt-6 mb-8">
          <div className="grid grid-cols-1 gap-6">
            {edition.sections.map((section, i) => (
              <div key={i} className="border-b border-gray-200 pb-5 last:border-b-0">
                <div className="text-[10px] font-bold tracking-widest text-gray-500 uppercase mb-2" style={{ fontFamily: SANS }}>
                  {SECTION_LABELS[section.category] || section.category}
                </div>
                <h3 className={`${t.sectionTitle} font-bold text-black leading-snug mb-2`} style={{ fontFamily: SERIF }}>
                  {section.title}
                </h3>
                {section.image_url && (
                  <figure className="mb-3">
                    <img
                      src={section.image_url}
                      alt={section.image_caption || section.title}
                      className="w-full h-auto object-cover"
                    />
                    {section.image_caption && (
                      <figcaption className="text-center text-xs text-gray-600 italic mt-1.5" style={{ fontFamily: SERIF }}>
                        {section.image_caption}
                      </figcaption>
                    )}
                  </figure>
                )}
                <div className={`${t.sectionBody} text-gray-900 leading-relaxed space-y-2`} style={{ fontFamily: SERIF }}>
                  {(section.body || '').split('\n\n').map((para, j) => (
                    <p key={j}>{para}</p>
                  ))}
                </div>
                {section.byline && (
                  <div className="text-[10px] tracking-widest text-gray-500 uppercase mt-2" style={{ fontFamily: SANS }}>
                    By {section.byline}{section.role ? ` · ${section.role}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── AROUND TOWN ─────────────────────────────────────────── */}
      {edition.around_town?.length > 0 && (
        <section className="border-t border-gray-300 pt-6 mb-8">
          <h3 className="text-sm font-bold tracking-widest text-black uppercase mb-3" style={{ fontFamily: SANS }}>
            Around Town
          </h3>
          <ul className="space-y-2.5">
            {edition.around_town.map((item, i) => (
              <li key={i} className={`flex gap-2 ${t.brief} text-gray-800`} style={{ fontFamily: SERIF }}>
                <span className="text-gray-400 mt-1">•</span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── BOTTOM BAR ──────────────────────────────────────────── */}
      <footer className="border-t-2 border-black pt-4 mt-8">
        <div className={`flex ${compact ? 'flex-col gap-2' : 'items-center justify-between'} text-[10px] tracking-widest text-gray-600`} style={{ fontFamily: SANS }}>
          <div>
            <div className="font-bold text-black">NEXT EDITION: SUNDAY</div>
            <div className="mt-0.5">PUBLISHED WEEKLY · 1:00 PM EASTERN</div>
          </div>
          <div className={compact ? 'text-left' : 'text-right'}>
            <div className="italic text-gray-600" style={{ fontFamily: SERIF }}>
              The Weekly is your source for what's happening in our world.
            </div>
            <div className="mt-0.5">Stay informed. Stay connected.</div>
          </div>
        </div>
      </footer>

      {/* Refresh timestamp */}
      {edition.publication_type === 'manual_refresh' && edition.refreshed_at && (
        <div className="text-center text-[10px] text-gray-400 mt-4" style={{ fontFamily: SANS }}>
          Updated {new Date(edition.refreshed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </div>
      )}
    </article>
  );
}