import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Newspaper, Loader2, Star, MapPin } from 'lucide-react';

const SECTION_LABELS = {
  community_spotlight: 'Community Spotlight',
  campaign_watch: 'Campaign Watch',
  neighborhood_news: 'What\'s Happening in Your Neighborhood',
};

export default function WeeklyPublicationCard() {
  const { data: edition, isLoading } = useQuery({
    queryKey: ['latestWeeklyPublication'],
    queryFn: async () => {
      const results = await base44.entities.WeeklyPublication.list('-edition_date', 1);
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

  if (!edition.has_sufficient_material) {
    return (
      <div className="bg-card border border-border rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Newspaper className="w-4 h-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">The Weekly</h3>
            <p className="text-[10px] text-muted-foreground">Edition #{edition.edition_number} · {edition.edition_date}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground italic">
          A quiet week in the world. No significant public events were recorded for this edition.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-secondary/30">
        <div className="flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-primary" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">The Weekly</h3>
            <p className="text-[10px] text-muted-foreground">Edition #{edition.edition_number} · {edition.edition_date}</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Headliner */}
        {edition.headliner && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Headliner</span>
              <span className="text-[9px] text-muted-foreground ml-auto">{SECTION_LABELS[edition.headliner.category] || edition.headliner.category}</span>
            </div>
            <h4 className="text-sm font-bold text-foreground leading-snug">{edition.headliner.title}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">{edition.headliner.summary}</p>
            {edition.headliner.character_names?.length > 0 && (
              <div className="flex items-center gap-1 mt-1">
                <MapPin className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">{edition.headliner.character_names.join(', ')}</span>
              </div>
            )}
          </div>
        )}

        {/* Sections */}
        {edition.sections?.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-border">
            {edition.sections.map((section, i) => (
              <div key={i} className="space-y-1">
                <span className="text-[9px] font-bold uppercase tracking-wider text-primary">
                  {SECTION_LABELS[section.category] || section.category}
                </span>
                <p className="text-xs font-medium text-foreground">{section.title}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{section.summary}</p>
                {section.character_names?.length > 0 && (
                  <p className="text-[10px] text-muted-foreground/70">{section.character_names.join(', ')}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}