import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLatestWeeklyEdition } from '@/lib/latestWeeklyEdition';
import WeeklyEditionReader from '@/components/weekly/WeeklyEditionReader';
import { ChevronLeft, Newspaper, Loader2 } from 'lucide-react';

/**
 * PhoneNewsApp — News, inside the scene's phone.
 *
 * A second reading surface for the ONE existing publication. It retrieves the edition
 * through the same query key and the same retrieval function the Home page card and The
 * Weekly page use, and draws it with the same WeeklyEditionReader — so it shows the exact
 * edition those places show, and an updated edition appears here too.
 *
 * It never calls the publication generator: opening News is a read, so no edition is
 * created, refreshed or replaced, and no date is decided here. Reading happens inside the
 * phone's own scroll area; the scene behind it is untouched.
 */
export default function PhoneNewsApp({ onBack }) {
  const { data: edition, isLoading } = useQuery({
    queryKey: ['latestWeeklyPublication'],
    queryFn: fetchLatestWeeklyEdition,
    staleTime: 2 * 60 * 1000,
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 px-3 py-2 text-white/90 flex-shrink-0">
        <button onClick={onBack} title="Back to apps" className="p-1 rounded-full hover:bg-white/10">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <Newspaper className="w-3.5 h-3.5" />
        <span className="text-[11px] font-semibold">News</span>
        <span className="ml-auto text-[9px] text-white/60">The Weekly</span>
      </div>

      {/* The reading area scrolls on its own, inside the phone frame. The scene behind it
          is never the thing being scrolled, and the edition never spills past the frame. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
        <div className="rounded-xl bg-[#f8f8f8] px-3 py-3" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
            </div>
          ) : (
            // An unfinished request is a loading state, never "not available": the message
            // only appears once the retrieval has finished and found no edition at all.
            <WeeklyEditionReader
              edition={edition}
              compact
              emptyNotice="The Weekly is not currently available."
            />
          )}
        </div>
      </div>
    </div>
  );
}