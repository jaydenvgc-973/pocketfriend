import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Newspaper, Loader2, Star, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const SECTION_LABELS = {
  community_spotlight: 'Community Spotlight',
  campaign_watch: 'Campaign Watch',
  neighborhood_news: 'What\'s Happening in Your Neighborhood',
};

export default function WeeklyPublicationCard() {
  const navigate = useNavigate();

  const { data: edition, isLoading } = useQuery({
    queryKey: ['latestWeeklyPublication'],
    queryFn: async () => {
      const results = await base44.entities.WeeklyPublication.list('-published_at', 1);
      return results[0] || null;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!edition) {
    return null; // No editions yet — don't show anything
  }

  return (
    <button
      onClick={() => navigate('/the-weekly')}
      className="w-full text-left bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/40 transition-colors group"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center gap-2">
        <Newspaper className="w-4 h-4 text-primary" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">The Weekly</h3>
          <p className="text-[10px] text-muted-foreground">
            Edition #{edition.edition_number} · {edition.edition_date}
            {edition.publication_type === 'manual_refresh' && ' · Updated'}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
      </div>

      <div className="p-4 space-y-3">
        {!edition.has_sufficient_material ? (
          <p className="text-xs text-muted-foreground italic">
            A quiet week in the world. No significant public events were recorded for this edition.
          </p>
        ) : (
          <>
            {/* Headliner preview */}
            {edition.headliner && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Headliner</span>
                </div>
                <h4 className="text-sm font-bold text-foreground leading-snug">{edition.headliner.title}</h4>
                {edition.headliner.image_url && (
                  <img
                    src={edition.headliner.image_url}
                    alt={edition.headliner.title}
                    className="w-full h-32 object-cover rounded-lg mt-1.5"
                  />
                )}
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {edition.headliner.subtitle || (edition.headliner.body || '').split('\n\n')[0]}
                </p>
              </div>
            )}

            {/* Section count */}
            {edition.sections?.length > 0 && (
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <span className="text-[10px] text-muted-foreground">
                  {edition.sections.length} {edition.sections.length === 1 ? 'story' : 'stories'}
                  {edition.around_town?.length > 0 && ` · ${edition.around_town.length} briefs`}
                </span>
                <span className="text-[10px] text-primary font-medium ml-auto flex items-center gap-0.5">
                  Read full edition <ChevronRight className="w-3 h-3" />
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </button>
  );
}