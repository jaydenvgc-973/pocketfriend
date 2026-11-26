import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { fetchLatestWeeklyEdition } from '@/lib/latestWeeklyEdition';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
// The edition itself is drawn by the one shared reader, which the scene phone's News app
// renders too — both surfaces show the same record with the same wording.
import WeeklyEditionReader from '@/components/weekly/WeeklyEditionReader';

export default function TheWeekly() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: edition, isLoading } = useQuery({
    queryKey: ['latestWeeklyPublication'],
    queryFn: fetchLatestWeeklyEdition,
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
        <WeeklyEditionReader edition={edition} />
      </div>
    </div>
  );
}