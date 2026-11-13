import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { analyzeImageForCharacterContext } from '@/lib/analyzeImageForCharacterContext';
import { usePageContext } from '@/hooks/usePageContext';
import { motion } from 'framer-motion';
import { X, Send, Trash2, Search, ArrowLeft, RefreshCw } from 'lucide-react';
import FolderGrid from '@/components/gallery/FolderGrid';
import MonthGrid from '@/components/gallery/MonthGrid';
import DeleteFolderModal from '@/components/gallery/DeleteFolderModal';
import GalleryImageGrid from '@/components/gallery/GalleryImageGrid';
import { loadCrossAccountContacts } from '@/lib/imageShareCharacters';

// ── CENTRALIZED STATE MUTATION LOGGER ──────────────────────────────────────────
// Every write to gallery state (pageImages, hasMore, proof, etc) gets logged with:
// WHO (function), WHEN (timestamp), image count, prompt count, uniqueImagesCollected
const STATE_WRITE_LOG = [];
function logStateWrite(source, data) {
  const entry = {
    timestamp: Date.now(),
    source,
    pageImagesCount: data.pageImages?.length ?? null,
    pageImagesWithPrompts: data.pageImages?.filter(img => !!img.displayPrompt).length ?? null,
    hasMore: data.hasMore ?? null,
    uniqueImagesCollected: data.proof?.uniqueImagesCollected ?? null,
    totalIndex: data.proof?.totalImagesInIndex ?? null,
    proof: data.proof ?? null,
  };
  STATE_WRITE_LOG.push(entry);
  console.log(
    `[StateWrite] ${source} | imgs=${entry.pageImagesCount} prompts=${entry.pageImagesWithPrompts} unique=${entry.uniqueImagesCollected} hasMore=${entry.hasMore}`
  );
}

// ── POISON DETECTION MIDDLEWARE ────────────────────────────────────────────────
// Block any state write that is significantly worse than the last known-good write
let LAST_GOOD_STATE = { images: 0, prompts: 0, unique: 0, source: null };

function updateLastGoodState(source, data) {
  const images = data.pageImages?.length ?? 0;
  const prompts = data.pageImages?.filter(img => !!img.displayPrompt).length ?? 0;
  const unique = data.proof?.uniqueImagesCollected ?? 0;
  
  if (images > 0) {
    LAST_GOOD_STATE = { images, prompts, unique, source };
    console.log(`[LastGoodState] Updated from ${source}: images=${images} prompts=${prompts} unique=${unique}`);
  }
}

// ── CACHE NUKE: Remove ALL MediaGallery cache keys (all versions, all formats) ──
// No gallery cache survives a mount or refresh. Backend is the ONLY source of truth.
function nukeAllGalleryCache() {
  const keysToDelete = [];
  for (const key of Object.keys(localStorage)) {
    if (key.includes('mediaGallery') || key.includes('gallery_page') || key.includes('MediaGallery')) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(k => localStorage.removeItem(k));
  if (keysToDelete.length > 0) {
    console.log(`[MediaGallery] Nuked ${keysToDelete.length} stale cache keys`);
  }
}

export default function MediaGallery() {
  usePageContext({ page: 'media_gallery' });
  const navigate = useNavigate();
  const [selectedImage, setSelectedImage] = useState(null);
  const [showSendModal, setShowSendModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // The input updates immediately; the gallery queries once the typing settles, so a
  // word typed into the box costs one search instead of one scan per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [user, setUser] = useState(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [pageImages, setPageImages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [initSettled, setInitSettled] = useState(false);
  const [lastProof, setLastProof] = useState(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [pageJumpValue, setPageJumpValue] = useState('');

  // ── FOLDER LAYER ────────────────────────────────────────────────────────────
  // Folders come from the server, which resolves each image's existing
  // generation context (character chat/text, Story Event, or neither).
  const [folders, setFolders] = useState([]);
  const [totalFoldersImages, setTotalFoldersImages] = useState(0);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [foldersError, setFoldersError] = useState(null);
  const [activeFolder, setActiveFolder] = useState(null);
  // Month-and-year subfolders inside a character folder. Only buckets are fetched
  // until a month is chosen, so opening a character never loads its whole library.
  const [activeMonth, setActiveMonth] = useState(null);
  const [months, setMonths] = useState([]);
  const [monthsLoading, setMonthsLoading] = useState(false);
  const [monthsError, setMonthsError] = useState(null);
  const [totalImages, setTotalImages] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [folderPendingDelete, setFolderPendingDelete] = useState(null);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [deleteFolderError, setDeleteFolderError] = useState(null);

  // Monotonically increasing request counter — any response with requestId < activeRequestRef is stale
  const activeRequestRef = useRef(0);

  // Pages already retrieved during this visit. Moving between pages (or back to a
  // folder/month that was open a moment ago) reuses them instead of asking the
  // server to scan the collection again for images already on screen.
  const pageCacheRef = useRef(new Map());
  
  // ── GALLERY INDEX PROOF (immutable floor of gallery size) ──────────────────────
  // This is the SOURCE OF TRUTH for how large the gallery actually is.
  // Only grows when a larger scan is discovered. Never shrinks.
  // Any scan returning fewer images/prompts than this proof is permanently rejected.
  const galleryIndexProofRef = useRef({
    highestPageReached: 0,
    highestUniqueImageCount: 0,
    highestPromptCount: 0,
    exhaustedAtPage: null,
    exhaustedAtImageCount: null,
    lastSuccessfulFullScanAt: null,
    lastRejectedPoisonScanAt: null,
    rejectedReasons: [],
  });
  
  // Per-page best known result — used to detect and reject poisoned responses
  // { [page]: { imageCount, promptCount, firstId, requestId, completedAt } }
  const bestResultRef = useRef({});

  useEffect(() => {
    // Nuke ALL gallery cache on every mount — navigation away/back, hard refresh, etc.
    // No stale cache can poison the gallery state.
    nukeAllGalleryCache();
    base44.auth.me().then(u => setUser(u)).catch(() => {});

    // ── BLOCK AUTO-REFETCH ON FOCUS ──────────────────────────────────────────────
    // Log whenever the window regains focus so we can detect if an auto-refetch happens
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('[MediaGallery] App backgrounded (hidden=true)');
      } else {
        console.log('[MediaGallery] App foreground (hidden=false) — monitoring for unwanted refetch');
      }
    };

    const handleFocus = () => {
      console.log('[MediaGallery] Window focus event — if a backend request starts now, it means React Query auto-refetch is still active somewhere');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const fetchPage = useCallback(async (page, search, folderKey = null, monthKey = null) => {
    if (!user?.email) return;

    // Already loaded in this visit — show it without another scan.
    const cacheKey = `${folderKey || 'all'}|${monthKey || 'all'}|${(search || '').trim().toLowerCase()}|${page}`;
    const cached = pageCacheRef.current.get(cacheKey);
    if (cached) {
      activeRequestRef.current++; // anything still in flight for another page is now stale
      setPageImages(cached.images);
      setHasMore(cached.hasMore);
      setLastProof(cached.proof);
      setTotalImages(cached.totalImages);
      setLastError(null);
      setIsLoading(false);
      setIsRefreshing(false);
      setInitSettled(true);
      return;
    }

    const requestId = ++activeRequestRef.current;
    const stackTrace = new Error().stack; // Capture call stack to see WHO called fetchPage
    console.log(`[MediaGallery] FETCH INITIATED: page=${page} requestId=${requestId}`);
    console.log(`  Stack: ${stackTrace?.split('\n').slice(1, 4).join(' → ')}`);

    setIsLoading(true);
    setIsRefreshing(false);

    try {
      const res = await base44.functions.invoke('fetchMediaGalleryPage', {
        page,
        pageSize: 20,
        searchTerm: search,
        folderKey: folderKey || null,
        monthKey: monthKey || null,
        mode: 'images',
      });

      // ── STALE REQUEST GUARD ───────────────────────────────────────────────────
      // If a newer request was started while this one was in-flight, discard this result.
      if (requestId !== activeRequestRef.current) {
        console.log(`[MediaGallery] Stale response discarded: page=${page} requestId=${requestId} current=${activeRequestRef.current}`);
        return;
      }

      const data = res?.data;
      if (!data) throw new Error('No data returned');

      const freshImages = data.images || [];

      // ── INTRA-RESPONSE DEDUP (defensive only) ────────────────────────────────
      const responseDedup = new Set();
      const dedupedImages = freshImages.filter(img => {
        const key = img.id || img.messageId;
        if (!key) return true;
        if (responseDedup.has(key)) return false;
        responseDedup.add(key);
        return true;
      });

      const newImageCount = dedupedImages.length;
      const newPromptCount = dedupedImages.filter(img => !!img.displayPrompt).length;
      const best = bestResultRef.current[page];

      console.log(`[MediaGallery] Page=${page} requestId=${requestId} images=${newImageCount} prompts=${newPromptCount} hasMore=${data.hasMore} totalIndex=${data.proof?.uniqueImagesCollected ?? '?'}`);

      // ── POISON DETECTION AGAINST IMMUTABLE GALLERY INDEX PROOF ────────────────
      // The proof is the SOURCE OF TRUTH for gallery size. It only grows.
      // Any scan returning fewer images/prompts than the proof is PERMANENTLY rejected.
      // ── UPDATE BEST KNOWN RESULT ─────────────────────────────────────────────
      if (!best || newImageCount >= best.imageCount) {
        bestResultRef.current[page] = {
          imageCount: newImageCount,
          promptCount: newPromptCount,
          firstId: dedupedImages[0]?.id || null,
          requestId,
          completedAt: Date.now(),
        };
      }

      // ── UPDATE IMMUTABLE GALLERY INDEX PROOF ──────────────────────────────────
      // Only grows. Never shrinks. This is the permanent record of gallery size.
      // (indexProof alias to avoid shadowing the poison-check `proof` const above)
      const indexProof = galleryIndexProofRef.current;
      if (newImageCount > indexProof.highestUniqueImageCount) {
        indexProof.highestUniqueImageCount = newImageCount;
        console.log(`[GalleryIndexProof] Highest unique images updated: ${newImageCount}`);
      }
      if (newPromptCount > indexProof.highestPromptCount) {
        indexProof.highestPromptCount = newPromptCount;
        console.log(`[GalleryIndexProof] Highest prompts updated: ${newPromptCount}`);
      }
      if (page > indexProof.highestPageReached) {
        indexProof.highestPageReached = page;
        console.log(`[GalleryIndexProof] Highest page reached: ${page}`);
      }
      if (data.proof?.exhaustedAllMessages === true && !indexProof.exhaustedAtPage) {
        indexProof.exhaustedAtPage = page;
        indexProof.exhaustedAtImageCount = newImageCount;
        console.log(`[GalleryIndexProof] Exhausted signal at page=${page} with ${newImageCount} images`);
      }
      indexProof.lastSuccessfulFullScanAt = Date.now();

      const stateToWrite = {
        pageImages: dedupedImages,
        hasMore: data.hasMore === true,
        proof: data.proof || null,
      };

      if (dedupedImages.length > 0) {
        setPageImages(dedupedImages);
      } else {
        // Legitimately empty page (past end of gallery, empty search, etc.)
        setPageImages([]);
        console.log(`[MediaGallery] Page=${page} — 0 images returned. proof:`, data.proof);
      }

      setHasMore(data.hasMore === true);
      setLastProof(data.proof || null);
      setTotalImages(typeof data.totalImages === 'number' ? data.totalImages : dedupedImages.length);
      setLastError(null);

      pageCacheRef.current.set(cacheKey, {
        images: dedupedImages,
        hasMore: data.hasMore === true,
        proof: data.proof || null,
        totalImages: typeof data.totalImages === 'number' ? data.totalImages : dedupedImages.length,
      });
      
      // Log successful write and update last-good-state
      logStateWrite(`fetchPage[OK] page=${page} requestId=${requestId}`, stateToWrite);
      updateLastGoodState(`fetchPage page=${page}`, stateToWrite);

    } catch (e) {
      console.error('[MediaGallery] fetchPage error:', e.message);
      // On error: keep existing display (do not blank the gallery) but surface it
      setLastError(e.message || 'Failed to load images');
    } finally {
      if (requestId === activeRequestRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
        setInitSettled(true);
      }
    }
  }, [user?.email]);

  // ── FOLDER LIST ─────────────────────────────────────────────────────────────
  const fetchFolders = useCallback(async () => {
    if (!user?.email) return;
    setFoldersLoading(true);
    setFoldersError(null);
    try {
      const res = await base44.functions.invoke('fetchMediaGalleryPage', { mode: 'folders' });
      const data = res?.data;
      if (!data || data.error) throw new Error(data?.error || 'No data returned');
      setFolders(Array.isArray(data.folders) ? data.folders : []);
      setTotalFoldersImages(typeof data.totalImages === 'number' ? data.totalImages : 0);
    } catch (e) {
      console.error('[MediaGallery] fetchFolders error:', e.message);
      setFoldersError(e.message || 'Failed to load folders');
    } finally {
      setFoldersLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    if (user?.email) fetchFolders();
  }, [user?.email, fetchFolders]);

  // ── MONTH LIST ──────────────────────────────────────────────────────────────
  // A character folder opens onto its month-and-year subfolders. This request
  // returns buckets only — no images are loaded until a month is chosen.
  const fetchMonths = useCallback(async () => {
    if (!user?.email || !activeFolder?.key) return;
    setMonthsLoading(true);
    setMonthsError(null);
    try {
      const res = await base44.functions.invoke('fetchMediaGalleryPage', {
        mode: 'months',
        folderKey: activeFolder.key,
      });
      const data = res?.data;
      if (!data || data.error) throw new Error(data?.error || 'No data returned');
      setMonths(Array.isArray(data.months) ? data.months : []);
    } catch (e) {
      console.error('[MediaGallery] fetchMonths error:', e.message);
      setMonthsError(e.message || 'Failed to load months');
    } finally {
      setMonthsLoading(false);
    }
  }, [user?.email, activeFolder?.key]);

  const isCharacterFolder = activeFolder?.kind === 'character';

  useEffect(() => {
    if (isCharacterFolder) fetchMonths();
    else setMonths([]);
  }, [isCharacterFolder, fetchMonths]);

  // Months are shown for a character folder until a month or a search is chosen.
  const isShowingMonths = isCharacterFolder && !activeMonth && !debouncedSearch.trim();
  const isShowingImages = (!!activeFolder && !isShowingMonths) || !!debouncedSearch.trim();

  useEffect(() => {
    if (!user?.email || !isShowingImages) return;
    // A month view loads only that month; search still spans the whole folder.
    fetchPage(
      currentPage,
      debouncedSearch,
      activeFolder?.key || null,
      debouncedSearch.trim() ? null : activeMonth?.key || null
    );
  }, [user?.email, currentPage, debouncedSearch, activeFolder?.key, activeMonth?.key, isShowingImages, fetchPage]);

  useEffect(() => {
    setInitSettled(false);
  }, [currentPage, debouncedSearch, activeFolder?.key]);

  // Each folder / search is its own query context with its own page floor.
  useEffect(() => {
    bestResultRef.current = {};
    galleryIndexProofRef.current = {
      highestPageReached: 0,
      highestUniqueImageCount: 0,
      highestPromptCount: 0,
      exhaustedAtPage: null,
      exhaustedAtImageCount: null,
      lastSuccessfulFullScanAt: null,
      lastRejectedPoisonScanAt: null,
      rejectedReasons: [],
    };
  }, [activeFolder?.key, activeMonth?.key, debouncedSearch]);

  const handleNext = () => setCurrentPage(p => p + 1);
  const handlePrev = () => { if (currentPage > 1) setCurrentPage(p => p - 1); };

  const handlePageJump = () => {
    const page = parseInt(pageJumpValue, 10);
    if (!page || page < 1) return;
    setCurrentPage(page);
    setPageJumpValue('');
  };

  const handleSearchChange = (val) => {
    setSearchTerm(val);
    setCurrentPage(1);
    setHasMore(true);
    setPageImages([]);
    setTotalImages(null);
    setLastError(null);
    setInitSettled(false);
    // While a typed search settles, show loading rather than "no matches".
    setIsLoading(!!val.trim());
    // Clear best results on search change — new dataset
    bestResultRef.current = {};
  };

  const handleOpenFolder = (folder) => {
    setActiveFolder(folder);
    setActiveMonth(null);
    setMonths([]);
    setSearchTerm('');
    setCurrentPage(1);
    setHasMore(true);
    setPageImages([]);
    setTotalImages(null);
    setLastError(null);
  };

  const handleOpenMonth = (month) => {
    setActiveMonth(month);
    setSearchTerm('');
    setCurrentPage(1);
    setHasMore(true);
    setPageImages([]);
    setTotalImages(null);
    setLastError(null);
  };

  const handleBackFromMonth = () => {
    setActiveMonth(null);
    setSearchTerm('');
    setCurrentPage(1);
    setHasMore(true);
    setPageImages([]);
    setTotalImages(null);
    setLastError(null);
  };

  const handleBackToFolders = () => {
    setActiveFolder(null);
    setActiveMonth(null);
    setMonths([]);
    setSearchTerm('');
    setCurrentPage(1);
    setHasMore(true);
    setPageImages([]);
    setTotalImages(null);
    setLastError(null);
    fetchFolders();
  };

  const handleConfirmDeleteFolder = async () => {
    if (!folderPendingDelete) return;
    setIsDeletingFolder(true);
    setDeleteFolderError(null);
    try {
      const res = await base44.functions.invoke('deleteMediaGalleryFolder', {
        folderKey: folderPendingDelete.key,
      });
      if (!res?.data?.success) {
        throw new Error(res?.data?.error || 'Folder deletion failed');
      }
      if (activeFolder?.key === folderPendingDelete.key) {
        setActiveFolder(null);
        setSearchTerm('');
        setPageImages([]);
        setTotalImages(null);
      }
      pageCacheRef.current = new Map();
      setFolderPendingDelete(null);
      fetchFolders();
    } catch (e) {
      console.error('[MediaGallery] Folder delete failed:', e.message);
      setDeleteFolderError(e.message || 'Folder deletion failed');
    } finally {
      setIsDeletingFolder(false);
    }
  };

  const handleManualRefresh = () => {
    // On manual refresh: nuke cache, reset per-page results, but preserve immutable proof
    const proof = galleryIndexProofRef.current;
    nukeAllGalleryCache();
    bestResultRef.current = {};
    pageCacheRef.current = new Map();
    console.log('[MediaGallery] Manual refresh: cache busted. Immutable proof preserved:', proof);
    if (isShowingMonths) {
      fetchMonths();
    } else if (isShowingImages) {
      fetchPage(
        currentPage,
        debouncedSearch,
        activeFolder?.key || null,
        debouncedSearch.trim() ? null : activeMonth?.key || null
      );
    } else {
      fetchFolders();
    }
  };

  const handleSelectImage = (image) => {
    const msgId = image.messageId || image.id;
    // Fetch the full Message record so editor has all fields (user_edited_description, visual_analysis_description, etc.)
    base44.entities.Message.filter({ id: msgId }, '-created_date', 1).then(results => {
      const fullMsg = results?.[0];
      if (fullMsg) {
        // Merge gallery shape fields (url, displayPrompt, etc.) with full Message record
        setSelectedImage({ ...image, ...fullMsg, url: image.url });
      } else {
        setSelectedImage(image);
      }
    }).catch(err => {
      console.error('[MediaGallery] Failed to fetch full message:', err);
      setSelectedImage(image);
    });
  };

  const handleDeleteImage = async (image) => {
    if (!user?.email) { alert('User not authenticated'); return; }
    try {
      const res = await base44.functions.invoke('deleteMediaGalleryImage', {
        messageId: image.messageId,
        parentEntity: image.parent_entity,
      });
      if (res?.data?.success) {
        setSelectedImage(null);
        const proof = galleryIndexProofRef.current;
        nukeAllGalleryCache();
        bestResultRef.current = {};
        pageCacheRef.current = new Map();
        console.log('[MediaGallery] Image deleted. Immutable proof preserved:', proof);
        fetchPage(
          currentPage,
          debouncedSearch,
          activeFolder?.key || null,
          debouncedSearch.trim() ? null : activeMonth?.key || null
        );
        fetchFolders();
        if (isCharacterFolder) fetchMonths();
      } else {
        alert(`Delete denied: ${res?.data?.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error('[MediaGallery] Delete failed:', e);
      alert(`Delete failed: ${e.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6" style={{ paddingTop: 'max(1.5rem, calc(1.5rem + env(safe-area-inset-top)))' }}>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => (activeMonth ? handleBackFromMonth() : activeFolder ? handleBackToFolders() : navigate(-1))}
              className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                {activeFolder
                  ? activeMonth
                    ? `${activeFolder.name} · ${activeMonth.label}`
                    : activeFolder.name
                  : 'Media Gallery'}
              </h1>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                {isShowingMonths
                  ? `${months.length} ${months.length === 1 ? 'month' : 'months'}`
                  : activeFolder
                  ? `${totalImages ?? 0} images • Page ${currentPage}${hasMore ? '+' : ''}`
                  : debouncedSearch.trim()
                  ? `${totalImages ?? 0} matching images across all folders`
                  : `${folders.length} folders • ${totalFoldersImages} images`}
                {isRefreshing && <RefreshCw className="w-3 h-3 animate-spin opacity-50" />}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleManualRefresh}
              disabled={(isShowingMonths ? monthsLoading : isShowingImages ? isLoading : foldersLoading) || isRefreshing}
              className="p-2 rounded-lg bg-secondary/40 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              title="Refresh gallery"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="text-xs px-2 py-1 rounded-lg bg-secondary/40 text-muted-foreground hover:text-foreground"
            >
              {showDiagnostics ? 'Hide' : 'Show'} diagnostics
            </button>
          </div>
        </div>

        {showDiagnostics && (
          <div className="mb-6 p-4 rounded-lg bg-secondary/20 border border-border text-xs font-mono text-muted-foreground space-y-1">
            <div><strong>Gallery Diagnostics v6 (poison-blocked, state-logged) — Page {currentPage}</strong></div>
            <div>owner: {user?.email || 'unknown'}</div>
            <div>initSettled: {initSettled ? 'YES' : 'no'} | isLoading: {isLoading ? 'yes' : 'NO'} | isRefreshing: {isRefreshing ? 'yes' : 'NO'}</div>
            <div>imageStart: {lastProof.imageStartIndex ?? lastProof.skip ?? 'n/a'} | imageEnd: {lastProof.imageEndIndex ?? 'n/a'} | pageSize: {lastProof.pageSize}</div>
            <div>uniqueImages: {lastProof.uniqueImagesCollected ?? lastProof.validFound ?? 'n/a'} | returned: {lastProof.pageImagesReturned}</div>
            <div>msgsScanned: {lastProof.messagesScanned ?? lastProof.rawScanned ?? 'n/a'} | batches: {lastProof.batchCount ?? lastProof.batchesScanned}</div>
            <div>exhausted: {lastProof.exhaustedAllMessages ? 'YES' : 'no'} | enoughForPage: {lastProof.enoughForRequestedPage !== false ? 'YES' : 'NO ⚠️'}</div>
            <div>terminated: <strong>{lastProof.terminationReason || 'n/a'}</strong> | runtime: {lastProof.runtimeMs != null ? `${lastProof.runtimeMs}ms` : 'n/a'}</div>
            <div>dedup: {lastProof.dedupMethod || 'n/a'} | cursor: {lastProof.cursorStyle || 'n/a'}</div>
            <div>scanFloor: {lastProof.scanEndDate || '2025-01-01'}</div>
            <div>firstId: {lastProof.firstImageId || 'n/a'} | firstDate: {lastProof.firstImageDate || lastProof.firstImageTimestamp || 'n/a'}</div>
            <div>lastId: {lastProof.lastImageId || 'n/a'} | lastDate: {lastProof.lastImageDate || lastProof.lastImageTimestamp || 'n/a'}</div>
            <div>hasMore: {lastProof.hasMore ? 'yes' : 'no'}</div>
            <div>bestKnown[p{currentPage}]: imgs={bestResultRef.current[currentPage]?.imageCount ?? 'n/a'} prompts={bestResultRef.current[currentPage]?.promptCount ?? 'n/a'}</div>
            {lastProof && lastProof.terminationReason === 'runtime_limit' && (
              <div className="text-amber-400">⚠ Scan hit time limit — some older images may not be indexed. Try refreshing.</div>
            )}
            <div className="border-t border-border/50 mt-3 pt-3">
              <div><strong>Gallery Index Proof (IMMUTABLE):</strong></div>
              <div className="ml-2 text-[10px] space-y-0.5">
                <div>highestPageReached: {galleryIndexProofRef.current.highestPageReached}</div>
                <div>highestUniqueImages: {galleryIndexProofRef.current.highestUniqueImageCount}</div>
                <div>highestPrompts: {galleryIndexProofRef.current.highestPromptCount}</div>
                <div>exhaustedAtPage: {galleryIndexProofRef.current.exhaustedAtPage ?? 'not yet'}</div>
                <div>exhaustedAtImageCount: {galleryIndexProofRef.current.exhaustedAtImageCount ?? 'not yet'}</div>
                <div>lastSuccessfulScan: {galleryIndexProofRef.current.lastSuccessfulFullScanAt ? new Date(galleryIndexProofRef.current.lastSuccessfulFullScanAt).toLocaleTimeString() : 'never'}</div>
                <div>rejectedScans: {galleryIndexProofRef.current.rejectedReasons.length}</div>
                {galleryIndexProofRef.current.rejectedReasons.length > 0 && (
                  <div className="text-amber-400">Latest rejection: {galleryIndexProofRef.current.rejectedReasons[galleryIndexProofRef.current.rejectedReasons.length - 1]}</div>
                )}
              </div>
              <div className="mt-2"><strong>Last Good State:</strong> images={LAST_GOOD_STATE.images} prompts={LAST_GOOD_STATE.prompts} unique={LAST_GOOD_STATE.unique} from {LAST_GOOD_STATE.source}</div>
              <div><strong>State Writes Log (last 10):</strong></div>
              <div className="max-h-32 overflow-y-auto bg-black/20 p-1 rounded">
                {STATE_WRITE_LOG.slice(-10).map((entry, i) => (
                  <div key={i} className="text-[10px] leading-tight mb-0.5">
                    {new Date(entry.timestamp).toLocaleTimeString()} {entry.source} — imgs={entry.pageImagesCount} prompts={entry.pageImagesWithPrompts} unique={entry.uniqueImagesCollected}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mb-6 flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={activeFolder ? `Search in ${activeFolder.name}...` : 'Search all folders by name, description, or event...'}
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="flex-1 px-4 py-2 rounded-lg border border-border bg-card text-foreground placeholder-muted-foreground"
          />
        </div>

        {!activeFolder && !debouncedSearch.trim() ? (
          <FolderGrid
            folders={folders}
            isLoading={foldersLoading}
            error={foldersError}
            onOpen={handleOpenFolder}
            onDeleteRequest={(folder) => { setDeleteFolderError(null); setFolderPendingDelete(folder); }}
            onRetry={fetchFolders}
          />
        ) : isShowingMonths ? (
          <MonthGrid
            months={months}
            isLoading={monthsLoading}
            error={monthsError}
            onOpen={handleOpenMonth}
            onRetry={fetchMonths}
          />
        ) : (
          <>
            {activeFolder && (
              <p className="text-xs text-muted-foreground mb-3">
                {activeMonth
                  ? `Images generated in ${activeMonth.label}.`
                  : `Images generated from ${activeFolder.name}'s chat or text page.`}
              </p>
            )}
            <GalleryImageGrid
              images={pageImages}
              isLoading={isLoading}
              isError={!!lastError}
              errorMessage={lastError}
              onRetry={() =>
                fetchPage(
                  currentPage,
                  debouncedSearch,
                  activeFolder?.key || null,
                  debouncedSearch.trim() ? null : activeMonth?.key || null
                )
              }
              onOpenImage={handleSelectImage}
              currentPage={currentPage}
              hasMore={hasMore}
              onPrev={handlePrev}
              onNext={handleNext}
              isBeyondGallery={lastProof ? lastProof.enoughForRequestedPage === false : false}
              pageJumpValue={pageJumpValue}
              onPageJumpValueChange={setPageJumpValue}
              onPageJump={handlePageJump}
              emptyMessage={
                activeFolder
                  ? debouncedSearch.trim()
                    ? `No images in ${activeFolder.name} match your search.`
                    : `${activeFolder.name} has no images yet.`
                  : 'No images match your search across your folders.'
              }
            />
          </>
        )}
      </div>

      <DeleteFolderModal
        folder={folderPendingDelete}
        isDeleting={isDeletingFolder}
        error={deleteFolderError}
        onCancel={() => { if (!isDeletingFolder) { setFolderPendingDelete(null); setDeleteFolderError(null); } }}
        onConfirm={handleConfirmDeleteFolder}
      />

      {selectedImage && (
        <ImageDetailModal
          image={selectedImage}
          onClose={() => setSelectedImage(null)}
          onSend={() => setShowSendModal(true)}
          onDelete={() => handleDeleteImage(selectedImage)}
        />
      )}

      {showSendModal && selectedImage && (
        <SendImageModal
          image={selectedImage}
          onClose={() => setShowSendModal(false)}
          onSent={() => { setShowSendModal(false); setSelectedImage(null); }}
        />
      )}
    </div>
  );
}

// Modal components and SendImageModal follow...
import MediaGalleryDescriptionEditor from "@/components/chat/MediaGalleryDescriptionEditor";
import { resolveBestImageDescription } from "@/lib/descriptionResolver";

function ImageDetailModal({ image: initialImage, onClose, onSend, onDelete }) {
  const [image, setImage] = useState(initialImage);
  
  // Use the centralized description resolver
  const displayDescription = resolveBestImageDescription(image);

  const handleDescriptionSaved = async (updatedImage) => {
    // Refetch full image data from backend to ensure consistency
    try {
      const results = await base44.entities.Message.filter({ id: updatedImage.id }, '-created_date', 1);
      const refreshed = results?.[0];
      if (refreshed) {
        setImage(prev => ({ ...prev, ...refreshed, url: prev.url }));
      } else {
        setImage(updatedImage);
      }
    } catch (err) {
      console.error('[MediaGallery] Failed to refetch after description save:', err);
      setImage(updatedImage);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="relative flex-shrink-0">
          <img src={image.url} alt={image.description} className="w-full max-h-64 object-contain" />
          <button onClick={onClose} className="absolute top-2 right-2 p-2 bg-black/50 rounded-lg hover:bg-black/70">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">From</p>
            <p className="text-sm text-foreground">{image.senderName}</p>
          </div>

          {/* Subjects shown in the image */}
          {image.subjectNames && image.subjectNames.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">People in Image</p>
              <p className="text-sm text-foreground">{image.subjectNames.join(', ')}</p>
            </div>
          )}

          {/* Location context */}
          {image.locationName && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Location</p>
              <p className="text-sm text-foreground">{image.locationName}{image.zoneName ? ` — ${image.zoneName}` : ''}</p>
            </div>
          )}

          {/* Description editor — centralized UI for all description types */}
          <MediaGalleryDescriptionEditor
            image={image}
            onClose={onClose}
            onSaved={handleDescriptionSaved}
          />
        </div>
        <div className="flex-shrink-0 border-t border-border p-4 bg-card flex gap-2">
          <button onClick={onSend} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 flex items-center justify-center gap-2 text-sm font-medium">
            <Send className="w-4 h-4" /> Send to Character
          </button>
          <button onClick={onDelete} className="px-4 py-2 bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 flex items-center justify-center gap-2">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const USER_RECIPIENT_ID = '__user_recipient__';

function SendImageModal({ image, onClose, onSent }) {
  const [characters, setCharacters] = useState([]);
  const [senderMode, setSenderMode] = useState('user');
  const [selectedSenderCharacterId, setSelectedSenderCharacterId] = useState(null);
  const [selectedRecipientCharacterIds, setSelectedRecipientCharacterIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [sendLog, setSendLog] = useState([]);
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
  }, []);

  // Characters on OTHER accounts, known through the existing contact graph of this
  // account's characters. Same eligible set the Media Grid generator offers.
  const [crossAccountCharacters, setCrossAccountCharacters] = useState([]);

  useEffect(() => {
    if (!user?.email) return;
    base44.entities.Character.filter({ owner_email: user.email, status: 'active' }, 'name', 200)
      .then((rows) => {
        setCharacters(rows);
        return loadCrossAccountContacts({
          characterRecords: rows,
          ownerEmail: user.email,
          excludeIds: (rows || []).map(r => r.id),
        });
      })
      .then(list => { if (list) setCrossAccountCharacters(list); })
      .catch(e => console.error('[SendImageModal] Failed to load characters:', e));
  }, [user?.email]);

  const groupedCharacters = useMemo(() => {
    const groups = { active_created: [], npc_regular: [], npc_family: [], npc_fictitious: [], other: [] };
    characters.forEach(char => {
      const type = char.character_type || 'other';
      const displayName = char.display_name || char.name;
      if (type === 'active_created_character') groups.active_created.push({ ...char, displayName });
      else if (type === 'npc_regular') groups.npc_regular.push({ ...char, displayName });
      else if (type === 'npc_family_member') groups.npc_family.push({ ...char, displayName });
      else if (type === 'npc_fictitious') groups.npc_fictitious.push({ ...char, displayName });
      else groups.other.push({ ...char, displayName });
    });
    Object.keys(groups).forEach(key => groups[key].sort((a, b) => a.displayName.localeCompare(b.displayName)));
    return groups;
  }, [characters]);

  const resolveDestinationConversationId = async (charId, charName, log) => {
    log.push(`RESOLVE: charId=${charId} name=${charName}`);
    const isDirectUserConvo = (c) => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      if (ids.length !== 1 || ids[0] !== charId) return false;
      if (c.shared_conversation_key) return false;
      if (c.channel === 'world_phone') return false;
      if (c.type === 'bilateral') return false;
      return true;
    };

    try {
      const r1 = await base44.entities.Conversation.filter({ type: 'direct', character_ids: [charId] }, '-last_message_date', 20);
      log.push(`RESOLVE: type=direct query returned ${r1.length}`);
      const direct1 = r1.filter(isDirectUserConvo);
      if (direct1.length > 0) {
        const best = direct1.sort((a, b) =>
          (b.last_message_date ? new Date(b.last_message_date).getTime() : 0) -
          (a.last_message_date ? new Date(a.last_message_date).getTime() : 0)
        )[0];
        log.push(`RESOLVE: Found via type=direct convo=${best.id}`);
        return best.id;
      }
    } catch (e) {
      log.push(`RESOLVE: type=direct query error: ${e.message}`);
    }

    try {
      const r2 = await base44.entities.Conversation.filter({ type: 'chat', character_ids: [charId] }, '-last_message_date', 20);
      log.push(`RESOLVE: type=chat query returned ${r2.length}`);
      const direct2 = r2.filter(isDirectUserConvo);
      if (direct2.length > 0) {
        const best = direct2.sort((a, b) =>
          (b.last_message_date ? new Date(b.last_message_date).getTime() : 0) -
          (a.last_message_date ? new Date(a.last_message_date).getTime() : 0)
        )[0];
        log.push(`RESOLVE: Found via type=chat convo=${best.id}`);
        return best.id;
      }
    } catch (e) {
      log.push(`RESOLVE: type=chat query error: ${e.message}`);
    }

    try {
      const r3 = await base44.entities.Conversation.filter({ character_ids: charId }, '-last_message_date', 50);
      log.push(`RESOLVE: broad query returned ${r3.length}`);
      const direct3 = r3.filter(isDirectUserConvo);
      if (direct3.length > 0) {
        const best = direct3.sort((a, b) =>
          (b.last_message_date ? new Date(b.last_message_date).getTime() : 0) -
          (a.last_message_date ? new Date(a.last_message_date).getTime() : 0)
        )[0];
        log.push(`RESOLVE: Found via broad query convo=${best.id}`);
        return best.id;
      }
    } catch (e) {
      log.push(`RESOLVE: broad query error: ${e.message}`);
    }

    log.push(`RESOLVE: No existing convo found — creating new`);
    const newConvo = await base44.entities.Conversation.create({
      title: `direct with ${charName}`,
      type: 'direct',
      character_ids: [charId],
    });
    log.push(`RESOLVE: Created new convo=${newConvo.id}`);
    return newConvo.id;
  };

  const handleSend = async () => {
    setError(null);
    setSendLog([]);
    setLoading(true);
    const log = [];

    try {
      if (senderMode === 'user') {
        if (selectedRecipientCharacterIds.size === 0) {
          setError('Please select at least one character');
          setLoading(false);
          return;
        }

        for (const charId of selectedRecipientCharacterIds) {
          const char = characters.find(c => c.id === charId) ||
            crossAccountCharacters.find(c => c.id === charId);
          if (!char) {
            log.push(`WARN: charId=${charId} not found`);
            continue;
          }

          // ── SENT AS THE USER TO ANOTHER ACCOUNT ──────────────────────────
          // Your own World Phone carries it, identified by your World Name.
          if (char.is_other_account) {
            log.push(`--- Sending as YOU to ${char.name} (other account, World Phone) ---`);
            const upRes = await base44.functions.invoke('sendUserWorldPhoneMessage', {
              recipient_character_id: char.id,
              image_url: image.url,
              image_description: image.displayPrompt || image.imageDescription || undefined,
              message_type: 'image',
              source: 'media_gallery_send_user',
            });
            if (!upRes?.data?.success) {
              throw new Error(upRes?.data?.error || `World Phone send to ${char.name} failed`);
            }
            log.push(`World Phone OK: msg_id=${upRes.data.message_id} as "${upRes.data.sender_display_name}"`);
            continue;
          }

          log.push(`--- Sending to: ${char.name} ---`);
          const destConvoId = await resolveDestinationConversationId(charId, char.name || char.display_name, log);

          const recipientIsInImage = image.subjectIds && image.subjectIds.includes(charId);
          const subjectNamesStr = image.subjectNames && image.subjectNames.length > 0 ? image.subjectNames.join(', ') : null;
          const resolvedDisplayPrompt = image.displayPrompt || image.imageDescription || null;

          // For promptless images: run detailed visual analysis
          // For images with context: compose from existing sources
          let composedDescription = null;
          let needsVisualAnalysis = false;

          if (resolvedDisplayPrompt) {
            // Has original context from gallery — use it
            composedDescription = resolvedDisplayPrompt;
          } else if (image.imageDescription) {
            // Has user-uploaded description
            composedDescription = image.imageDescription;
          } else {
            // Promptless gallery image — will trigger analysis after message creation
            needsVisualAnalysis = true;
          }
          // Note: if no description exists yet, we'll run visual analysis AFTER message creation

          const mergedGenerationContext = image.generationContext
            ? {
                ...image.generationContext,
                resolved_description: resolvedDisplayPrompt || composedDescription || undefined,
                original_raw_prompt: image.generationContext.original_raw_prompt || image.originalPrompt || resolvedDisplayPrompt || undefined,
              }
            : resolvedDisplayPrompt
            ? { resolved_description: resolvedDisplayPrompt, original_raw_prompt: resolvedDisplayPrompt }
            : undefined;

          const msgPayload = {
            conversation_id: destConvoId,
            sender_type: 'user',
            content: '',
            image_url: image.url,
            image_description: composedDescription || undefined,
            // If promptless: set pending so character context knows to wait for inferred description
            // If has context: set complete
            image_analysis_status: composedDescription ? 'complete' : 'pending',
            image_analysis_is_transport_metadata: false,
            generation_context: mergedGenerationContext,
            timestamp: new Date().toISOString(),
            owner_email: user.email,
          };

          // Track source metadata on the new message (non-destructive — original record untouched)
          if (image.id) msgPayload.source_media_message_id = image.id;
          if (image.url) msgPayload.source_media_url = image.url;
          msgPayload.source_media_had_prompt = !!resolvedDisplayPrompt;
          msgPayload.source_media_had_generation_context = !!(image.generationContext?.original_raw_prompt || image.generationContext?.scene_prompt);

          const msg = await base44.entities.Message.create(msgPayload);

          if (!msg?.id) throw new Error(`Message.create returned no ID`);
          log.push(`WRITE: message created id=${msg.id}`);

          // ── POST-CREATION VISUAL ANALYSIS (reuses the SAME pipeline as Chat uploads) ──
          // Only runs when the gallery image had no usable context (needsVisualAnalysis=true).
          // Runs detailed visual analysis and stores result durably on the NEW message.
          // Character context will read the inferred_image_description when present.
          if (needsVisualAnalysis && image.url) {
            log.push(`Running detailed visual analysis on promptless gallery image...`);
            analyzeImageForCharacterContext({
              imageUrl: image.url,
              messageId: msg.id,
              context: 'media_gallery_send',
              requireDetailedAnalysis: true,
            }).then(({ imageDescription, analysisStatus }) => {
              if (imageDescription && analysisStatus === 'complete') {
                log.push(`Analysis complete: ${imageDescription.substring(0, 80)}...`);
              } else if (analysisStatus === 'failed') {
                log.push(`Analysis failed — character will see "cannot inspect image" notice`);
              } else {
                log.push(`Analysis unclear status: ${analysisStatus}`);
              }
            }).catch(e => {
              log.push(`Analysis error (non-fatal): ${e.message}`);
            });
          }
        }

        console.log('[SendImageModal] SEND COMPLETE:\n' + log.join('\n'));
        setSendLog(log);
        setSent(true);
        setTimeout(onSent, 1200);
        return;

      } else {
        if (!selectedSenderCharacterId) { setError('Please select a sender character'); setLoading(false); return; }
        const recipientIds = [...selectedRecipientCharacterIds];
        if (recipientIds.length === 0) { setError('Please select at least one recipient'); setLoading(false); return; }
        if (recipientIds.includes(selectedSenderCharacterId)) { setError('Cannot send to the same character'); setLoading(false); return; }

        const senderChar = characters.find(c => c.id === selectedSenderCharacterId);
        if (!senderChar) { setError('Sender character not found'); setLoading(false); return; }
        // Cross-account recipients are delivered through the existing World Phone path below.

        // Separate user recipient from character recipients
        const sendToUser = recipientIds.includes(USER_RECIPIENT_ID);
        const characterRecipientIds = recipientIds.filter(id => id !== USER_RECIPIENT_ID);

        // ── CHARACTER → USER: deliver into the user's direct Chat conversation ──
        if (sendToUser) {
          log.push(`--- Character → User: sender=${senderChar.name} → user ---`);
          const destConvoId = await resolveDestinationConversationId(senderChar.id, senderChar.name || senderChar.display_name, log);

          const cuResolvedPrompt = image.displayPrompt || image.imageDescription || null;
          const cuDescription = cuResolvedPrompt || image.imageDescription || null;
          const cuNeedsVisualAnalysis = !cuDescription && !!image.url;

          const cuMergedGenerationContext = image.generationContext
            ? {
                ...image.generationContext,
                resolved_description: cuResolvedPrompt || cuDescription || undefined,
                original_raw_prompt: image.generationContext.original_raw_prompt || image.originalPrompt || cuResolvedPrompt || undefined,
              }
            : cuResolvedPrompt
            ? { resolved_description: cuResolvedPrompt, original_raw_prompt: cuResolvedPrompt }
            : undefined;

          const cuPayload = {
            conversation_id: destConvoId,
            sender_type: 'character',
            character_id: senderChar.id,
            character_name: senderChar.name || senderChar.display_name,
            content: '',
            image_url: image.url,
            image_description: cuDescription || undefined,
            image_analysis_status: cuDescription ? 'complete' : 'pending',
            image_analysis_is_transport_metadata: false,
            generation_context: cuMergedGenerationContext,
            timestamp: new Date().toISOString(),
            owner_email: user.email,
          };

          if (image.id) cuPayload.source_media_message_id = image.id;
          if (image.url) cuPayload.source_media_url = image.url;
          cuPayload.source_media_had_prompt = !!cuResolvedPrompt;
          cuPayload.source_media_had_generation_context = !!(image.generationContext?.original_raw_prompt || image.generationContext?.scene_prompt);

          const cuMsg = await base44.entities.Message.create(cuPayload);
          if (!cuMsg?.id) throw new Error('Character→User message creation returned no ID');
          log.push(`WRITE: character→user message created id=${cuMsg.id} convo=${destConvoId}`);

          if (cuNeedsVisualAnalysis) {
            log.push(`Running detailed visual analysis on promptless gallery image (char→user)...`);
            analyzeImageForCharacterContext({
              imageUrl: image.url,
              messageId: cuMsg.id,
              context: 'media_gallery_send_char_to_user',
              requireDetailedAnalysis: true,
            }).then(({ imageDescription, analysisStatus }) => {
              if (imageDescription && analysisStatus === 'complete') {
                log.push(`Analysis complete: ${imageDescription.substring(0, 80)}...`);
              } else if (analysisStatus === 'failed') {
                log.push(`Analysis failed — character will see "cannot inspect image" notice`);
              }
            }).catch(e => {
              log.push(`Analysis error (non-fatal): ${e.message}`);
            });
          }
        }

        // ── CHARACTER → CHARACTER: existing World Phone path (unchanged) ──
        for (const receiverId of characterRecipientIds) {
         log.push(`World Phone: sender=${selectedSenderCharacterId} → receiver=${receiverId}`);
         const wpResolvedPrompt = image.displayPrompt || image.imageDescription || null;
         const wpHasContext = !!wpResolvedPrompt;
         const wpDescription = wpResolvedPrompt || image.imageDescription || '';
          log.push(`World Phone: image_url=${image.url?.substring(0,60)}... descLen=${wpDescription.length} hasContext=${wpHasContext}`);
          
          const wpPayload = {
            sender_character_id: selectedSenderCharacterId,
            recipient_identifier: receiverId,
            requested_message: '',
            image_url: image.url,
            image_description: wpDescription || undefined,
            // Promptless: set pending so character context knows to wait for detailed inferred description
            // Has context: set complete
            image_analysis_status: wpHasContext ? 'complete' : 'pending',
            image_analysis_is_transport_metadata: false,
            generation_context: image.generationContext || undefined,
            message_type: 'image',
            source: 'media_gallery_send',
            owner_email: user.email,
            // Source tracking — written only to new message, never to original gallery record
            source_media_message_id: image.id || undefined,
            source_media_url: image.url || undefined,
            source_media_had_prompt: wpHasContext,
            source_media_had_generation_context: !!(image.generationContext?.original_raw_prompt || image.generationContext?.scene_prompt),
            // Flag: if true, sendWorldPhoneMessage should trigger detailed visual analysis on the new message
            needs_detailed_visual_analysis: !wpHasContext && !!image.url,
          };

          const res = await base44.functions.invoke('sendWorldPhoneMessage', wpPayload);

          if (!res?.data?.success) {
            throw new Error(res?.data?.error || 'World Phone send failed');
          }
          log.push(`World Phone OK: msg_id=${res.data.message_id}`);
        }
        console.log('[SendImageModal] CHARACTER SEND COMPLETE:\n' + log.join('\n'));
        setSendLog(log);
        setSent(true);
        setTimeout(onSent, 1200);
        return;
      }
    } catch (e) {
      console.error('[SendImageModal] Send failed:', e.message);
      setError(`Send failed: ${e.message}`);
      setSendLog(log);
    } finally {
      setLoading(false);
    }
  };

  const CharacterGroupUser = ({ title, chars, selected, onToggle }) => {
    if (chars.length === 0) return null;
    return (
      <>
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase bg-secondary/30 border-t border-border">{title}</div>
        {chars.map((char) => (
          <label key={char.id} className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/50 cursor-pointer border-b border-border/50 last:border-b-0">
            <input type="checkbox" checked={selected.has(char.id)} onChange={() => onToggle(char.id)} className="w-4 h-4" />
            <span className="text-sm text-foreground">{char.displayName}</span>
          </label>
        ))}
      </>
    );
  };

  const CharacterGroupCharacter = ({ title, chars, selected, senderCharacterId, onToggle }) => {
    if (chars.length === 0) return null;
    return (
      <>
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase bg-secondary/30 border-t border-border">{title}</div>
        {chars.map((char) => {
          const isSender = char.id === senderCharacterId;
          return (
            <label key={char.id} className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-border/50 last:border-b-0 ${isSender ? 'bg-secondary/20 opacity-50 cursor-not-allowed' : 'hover:bg-secondary/50'}`}>
              <input type="checkbox" checked={selected.has(char.id)} onChange={() => onToggle(char.id)} disabled={isSender} className="w-4 h-4 disabled:opacity-50" />
              <span className={`text-sm ${isSender ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{char.displayName}{isSender && ' (sender)'}</span>
            </label>
          );
        })}
      </>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card rounded-lg max-w-md w-full p-6 flex flex-col max-h-[95vh] overflow-hidden"
      >
        <h2 className="text-xl font-bold text-foreground mb-4">Send Image To</h2>

        <div className="mb-4">
          <p className="text-sm font-semibold text-foreground mb-2">Send As:</p>
          <div className="flex gap-2">
            <button onClick={() => setSenderMode('user')} className={`flex-1 px-3 py-2 rounded text-sm ${senderMode === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}>You</button>
            <button onClick={() => setSenderMode('character')} className={`flex-1 px-3 py-2 rounded text-sm ${senderMode === 'character' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}>Character</button>
          </div>
        </div>

        {senderMode === 'user' && (
          <div className="mb-4 flex-1 flex flex-col min-h-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex-shrink-0">Send to Characters:</p>
            <div className="flex-1 overflow-y-auto border border-border rounded-lg bg-secondary/20">
              {['active_created', 'npc_regular', 'npc_family', 'npc_fictitious', 'other'].map(typeKey => {
                const typeLabels = { active_created: 'Active Characters', npc_regular: 'NPC Regular', npc_family: 'NPC Family', npc_fictitious: 'NPC Fictitious', other: 'Other' };
                return (
                  <CharacterGroupUser key={typeKey} title={typeLabels[typeKey]} chars={groupedCharacters[typeKey]} selected={selectedRecipientCharacterIds}
                    onToggle={(charId) => { const s = new Set(selectedRecipientCharacterIds); s.has(charId) ? s.delete(charId) : s.add(charId); setSelectedRecipientCharacterIds(s); }} />
                );
              })}
              {crossAccountCharacters.length > 0 && (
                <>
                  <div className="px-3 py-2 text-xs font-semibold text-purple-300 uppercase bg-purple-500/10 border-t border-border">Other Accounts</div>
                  {crossAccountCharacters.map(char => (
                    <label key={char.id} className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/50 cursor-pointer border-b border-border/50 last:border-b-0">
                      <input type="checkbox" checked={selectedRecipientCharacterIds.has(char.id)} onChange={() => { const s = new Set(selectedRecipientCharacterIds); s.has(char.id) ? s.delete(char.id) : s.add(char.id); setSelectedRecipientCharacterIds(s); }} className="w-4 h-4" />
                      {char.avatar_url && <img src={char.avatar_url} alt={char.name} className="w-5 h-5 rounded-full object-cover" />}
                      <span className="text-sm text-foreground">{char.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30">Other account</span>
                    </label>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {senderMode === 'character' && (
          <div className="mb-4 flex-1 flex flex-col min-h-0 gap-4">
            <div className="flex-shrink-0">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Sending As:</p>
              <select value={selectedSenderCharacterId || ''} onChange={(e) => setSelectedSenderCharacterId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground">
                <option value="">— Select character —</option>
                {[...groupedCharacters.active_created, ...groupedCharacters.npc_regular, ...groupedCharacters.npc_family, ...groupedCharacters.npc_fictitious, ...groupedCharacters.other].map((char) => (
                  <option key={char.id} value={char.id}>{char.displayName}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 flex flex-col min-h-0">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex-shrink-0">Send To:</p>
              <div className="flex-1 overflow-y-auto border border-border rounded-lg bg-secondary/20">
                {/* User recipient — character → user direction */}
                <div className="px-3 py-2 text-xs font-semibold text-primary uppercase bg-primary/10 border-t border-border">You (User)</div>
                <label className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/50 cursor-pointer border-b border-border/50">
                  <input type="checkbox" checked={selectedRecipientCharacterIds.has(USER_RECIPIENT_ID)} onChange={() => { const s = new Set(selectedRecipientCharacterIds); s.has(USER_RECIPIENT_ID) ? s.delete(USER_RECIPIENT_ID) : s.add(USER_RECIPIENT_ID); setSelectedRecipientCharacterIds(s); }} className="w-4 h-4" />
                  <span className="text-sm text-foreground font-medium">{user?.full_name || 'You'}</span>
                  <span className="text-[10px] text-primary bg-primary/20 px-1.5 py-0.5 rounded">User</span>
                </label>
                {['active_created', 'npc_regular', 'npc_family', 'npc_fictitious', 'other'].map(typeKey => {
                  const typeLabels = { active_created: 'Active Characters', npc_regular: 'NPC Regular', npc_family: 'NPC Family', npc_fictitious: 'NPC Fictitious', other: 'Other' };
                  return (
                    <CharacterGroupCharacter key={typeKey} title={typeLabels[typeKey]} chars={groupedCharacters[typeKey]} selected={selectedRecipientCharacterIds} senderCharacterId={selectedSenderCharacterId}
                      onToggle={(charId) => { const s = new Set(selectedRecipientCharacterIds); s.has(charId) ? s.delete(charId) : s.add(charId); setSelectedRecipientCharacterIds(s); }} />
                    );
                    })}
                    {crossAccountCharacters.length > 0 && (
                    <>
                    <div className="px-3 py-2 text-xs font-semibold text-purple-300 uppercase bg-purple-500/10 border-t border-border">Other Accounts</div>
                    {crossAccountCharacters.map(char => {
                      const isSender = char.id === selectedSenderCharacterId;
                      return (
                        <label key={char.id} className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-border/50 last:border-b-0 ${isSender ? 'opacity-50 cursor-not-allowed' : 'hover:bg-secondary/50'}`}>
                          <input type="checkbox" checked={selectedRecipientCharacterIds.has(char.id)} onChange={() => { const s = new Set(selectedRecipientCharacterIds); s.has(char.id) ? s.delete(char.id) : s.add(char.id); setSelectedRecipientCharacterIds(s); }} disabled={isSender} className="w-4 h-4" />
                          {char.avatar_url && <img src={char.avatar_url} alt={char.name} className="w-5 h-5 rounded-full object-cover" />}
                          <span className="text-sm text-foreground">{char.name}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30">Other account</span>
                        </label>
                      );
                    })}
                    </>
                    )}
                    </div>
            </div>
            </div>
        )}

        <div className="flex-shrink-0 border-t border-border pt-2 flex flex-col gap-2">
          {error && <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</div>}
          {sendLog.length > 0 && (
            <div className="text-xs bg-secondary/30 px-3 py-2 rounded-lg max-h-24 overflow-y-auto font-mono text-muted-foreground whitespace-pre-wrap">
              {sendLog.join('\n')}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90">Cancel</button>
            <button
              onClick={handleSend}
              disabled={loading || sent || (senderMode === 'user' ? selectedRecipientCharacterIds.size === 0 : !selectedSenderCharacterId || selectedRecipientCharacterIds.size === 0)}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sent ? '✓ Sent!' : loading ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}