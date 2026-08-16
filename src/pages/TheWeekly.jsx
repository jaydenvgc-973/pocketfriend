import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Loader2, Newspaper } from 'lucide-react';

const SECTION_LABELS = {
  community_spotlight: 'Community Spotlight',
  campaign_watch: 'Campaign Watch',
  neighborhood_news: 'What\'s Happening in Your Neighborhood',
};

function formatDateLong(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return dateStr; }
}

function formatDateRange(start, end) {
  if (!start || !end) return '';
  try {
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    const sFmt = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const eFmt = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${sFmt} – ${eFmt}`;
  } catch { return `${start} – ${end}`; }
}

export default function TheWeekly() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: edition, isLoading } = useQuery({
    queryKey: ['latestWeeklyPublication'],
    queryFn: async () => {
      const results = await base44.entities.WeeklyPublication.list('-published_at', 1);
      return results[0] || null;
    },
    staleTime: 2 * 60 * 1000,
  });

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await base44.functions.invoke('generateWeeklyPublication', { mode: 'manual_refresh' });
      await queryClient.invalidateQueries({ queryKey: ['latestWeeklyPublication'] });
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f8f8f8] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f8f8]" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-[#f8f8f8]/95 backdrop-blur border-b border-gray-300 px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate('/home')}
          className="flex items-center gap-1.5 text-sm text-gray-700 hover:text-black transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 text-sm text-gray-700 hover:text-black transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'Updating...' : 'Refresh'}</span>
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 pb-20">
        {(!edition || !edition.has_sufficient_material) && !isLoading ? (
          <div className="text-center py-20">
            <Newspaper className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl text-gray-700 mb-2">A quiet week in the world</h2>
            <p className="text-sm text-gray-500">
              No significant public events were recorded for this edition.
              {edition?.edition_date && (
                <span className="block mt-2 text-xs">Edition #{edition.edition_number} · {formatDateLong(edition.edition_date)}</span>
              )}
            </p>
          </div>
        ) : edition ? (
          <article>
            {/* ── MASTHEAD ────────────────────────────────────────────── */}
            <header className="border-t-2 border-b-2 border-black py-4 mb-6">
              <div className="flex items-start justify-between text-[10px] tracking-widest text-gray-600 mb-2" style={{ fontFamily: 'Inter, sans-serif' }}>
                <div className="text-left">
                  <div className="font-bold text-black">VOL. 1 · ISSUE {edition.edition_number || '—'}</div>
                  <div className="mt-0.5">SERVING OUR COMMUNITY</div>
                </div>
                <div className="text-center">
                  <div className="text-[9px] tracking-widest text-gray-500">— YOUR WORLD. YOUR STORIES. —</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-black">EDITION #{edition.edition_number || '—'}</div>
                  <div className="mt-0.5">{formatDateRange(edition.week_start, edition.week_end)}</div>
                </div>
              </div>
              <h1 className="text-center text-5xl font-bold text-black tracking-tight" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                The Weekly
              </h1>
              <p className="text-center text-[10px] tracking-widest text-gray-500 mt-1" style={{ fontFamily: 'Inter, sans-serif' }}>
                A PUBLICATION OF THE WORLD WE SHARE
              </p>
              <div className="mt-3 pt-3 border-t border-gray-300 text-center text-xs tracking-widest text-gray-600 uppercase" style={{ fontFamily: 'Inter, sans-serif' }}>
                {formatDateLong(edition.edition_date)}
              </div>
            </header>

            {/* ── HEADLINER ───────────────────────────────────────────── */}
            {edition.headliner && (
              <section className="mb-8">
                <h2 className="text-2xl font-bold text-black leading-tight mb-2 uppercase" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                  {edition.headliner.title}
                </h2>
                {edition.headliner.subtitle && (
                  <p className="text-base text-gray-700 italic mb-3" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                    {edition.headliner.subtitle}
                  </p>
                )}
                <div className="text-[10px] tracking-widest text-gray-500 uppercase mb-4" style={{ fontFamily: 'Inter, sans-serif' }}>
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
                      <figcaption className="text-center text-xs text-gray-600 italic mt-2" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                        {edition.headliner.image_caption}
                      </figcaption>
                    )}
                  </figure>
                )}

                <div className="text-[15px] text-gray-900 leading-relaxed space-y-3" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                  {(edition.headliner.body || '').split('\n\n').map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>

                {edition.headliner.pull_quote && (
                  <blockquote className="my-5 pl-4 border-l-4 border-gray-300 text-lg italic text-gray-800" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                    "{edition.headliner.pull_quote}"
                  </blockquote>
                )}
              </section>
            )}

            {/* ── SECTIONS GRID ───────────────────────────────────────── */}
            {edition.sections?.length > 0 && (
              <section className="border-t border-gray-300 pt-6 mb-8">
                <div className="grid grid-cols-1 gap-6">
                  {edition.sections.map((section, i) => (
                    <div key={i} className="border-b border-gray-200 pb-5 last:border-b-0">
                      <div className="text-[10px] font-bold tracking-widest text-gray-500 uppercase mb-2" style={{ fontFamily: 'Inter, sans-serif' }}>
                        {SECTION_LABELS[section.category] || section.category}
                      </div>
                      <h3 className="text-lg font-bold text-black leading-snug mb-2" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
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
                            <figcaption className="text-center text-xs text-gray-600 italic mt-1.5" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                              {section.image_caption}
                            </figcaption>
                          )}
                        </figure>
                      )}
                      <div className="text-[14px] text-gray-900 leading-relaxed space-y-2" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                        {(section.body || '').split('\n\n').map((para, j) => (
                          <p key={j}>{para}</p>
                        ))}
                      </div>
                      {section.byline && (
                        <div className="text-[10px] tracking-widest text-gray-500 uppercase mt-2" style={{ fontFamily: 'Inter, sans-serif' }}>
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
                <h3 className="text-sm font-bold tracking-widest text-black uppercase mb-3" style={{ fontFamily: 'Inter, sans-serif' }}>
                  Around Town
                </h3>
                <ul className="space-y-2.5">
                  {edition.around_town.map((item, i) => (
                    <li key={i} className="flex gap-2 text-[14px] text-gray-800" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                      <span className="text-gray-400 mt-1">•</span>
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ── BOTTOM BAR ──────────────────────────────────────────── */}
            <footer className="border-t-2 border-black pt-4 mt-8">
              <div className="flex items-center justify-between text-[10px] tracking-widest text-gray-600" style={{ fontFamily: 'Inter, sans-serif' }}>
                <div>
                  <div className="font-bold text-black">NEXT EDITION: SUNDAY</div>
                  <div className="mt-0.5">PUBLISHED WEEKLY · 1:00 PM EASTERN</div>
                </div>
                <div className="text-right">
                  <div className="italic text-gray-600" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                    The Weekly is your source for what's happening in our world.
                  </div>
                  <div className="mt-0.5">Stay informed. Stay connected.</div>
                </div>
              </div>
            </footer>

            {/* Refresh timestamp */}
            {edition.publication_type === 'manual_refresh' && edition.refreshed_at && (
              <div className="text-center text-[10px] text-gray-400 mt-4" style={{ fontFamily: 'Inter, sans-serif' }}>
                Updated {new Date(edition.refreshed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            )}
          </article>
        ) : null}
      </div>
    </div>
  );
}