'use client';
import dynamic from "next/dynamic";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  GetAllPageList,
  UpdatePageStatus,
  SwitchProject,
  GetTags,
  GetFixedTags,
  SaveTimeStamps
} from '../wailsjs/go/main/App';

type TimeStamp = {
  label: string;
  time: number;
};

type PageHeader = {
  id: string;
  title: string;
  url: string;
  categoryId: number;
  statusId: number;
  sortId: number;
  tags: string[];
  thumbnailUrl: string;
  timeStamps?: TimeStamp[];
};

type ViewMode = 'MAIN_LIST' | 'DETAIL' | 'TAG_LIST';
type SearchMode = 'TITLE' | 'TAG';
type SortMode =
  | 'NEWEST'
  | 'OLDEST'
  | 'TITLE_ASC'
  | 'TITLE_DESC'
  | 'RANDOM';

type HistoryState = {
  viewMode: ViewMode;
  selectedPage: PageHeader | null;
  selectedTag: string | null;
  selectedStatus: number | null;
  project: string;
};

const STATUS_MAP: { [key: number]: { label: string; color: string; border: string; bg: string } } = {
  0: { label: '未試聴', color: 'text-gray-400', border: 'border-gray-500', bg: 'bg-gray-500/10' },
  1: { label: '登録予定', color: 'text-blue-400', border: 'border-blue-400', bg: 'bg-blue-400/10' },
  2: { label: '削除予定', color: 'text-red-400', border: 'border-red-400', bg: 'bg-red-400/10' },
  3: { label: '登録済', color: 'text-green-400', border: 'border-green-400', bg: 'bg-green-400/10' },
};

const TwitterEmbed = dynamic(() => import("./TwitterEmbed"), {
  ssr: false,
});

const kanaList = [
  "あ",
  "か",
  "さ",
  "た",
  "な",
  "は",
  "ま",
  "や",
  "ら",
  "わ",
];

// ─── 追加・修正：プロキシ経由で動画を再生する専用のクリーンなコンポーネント ───
// ※ルール違反を避けるため、Homeの外側に配置し独立させました。
const VideoPlayer = ({ url }: { url: string }) => {
  return (
    <FullscreenContainer
      className="
        aspect-video
        w-full
        overflow-hidden
        rounded-md
        shadow-lg
        border
        border-[#4f5764]
        bg-[#141619]
        flex
        items-center
        justify-center
      "
    >
      <video
        controls
        className="w-full h-full object-contain bg-black"
        src={`http://localhost:54321/video?url=${encodeURIComponent(url)}`}
      />
    </FullscreenContainer>
  );
};

const FullscreenContainer = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  const containerRef =
    useRef<HTMLDivElement>(null);

  const handleFullscreen =
    useCallback(async () => {
      const el =
        containerRef.current;

      if (!el) return;

      try {
        if (
          document.fullscreenElement
        ) {
          await document.exitFullscreen();
        } else {
          await el.requestFullscreen();
        }
      } catch (err) {
        console.error(
          'fullscreen error',
          err
        );
      }
    }, []);

  // ← 追加
  useEffect(() => {
    const handleKeyDown = (
      e: KeyboardEvent
    ) => {
      // 入力中は無効
      const target =
        e.target as HTMLElement;

      const isTyping =
        target.tagName === 'INPUT' ||
        target.tagName ===
          'TEXTAREA' ||
        target.isContentEditable;

      if (isTyping) return;

      // Ctrl+Fは無視
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      ) {
        return;
      }

      if (
        e.key.toLowerCase() ===
        'f'
      ) {
        e.preventDefault();
        handleFullscreen();
      }
    };

    window.addEventListener(
      'keydown',
      handleKeyDown
    );

    return () =>
      window.removeEventListener(
        'keydown',
        handleKeyDown
      );
  }, [handleFullscreen]);

  return (
    <div className="relative">
      <button
        onClick={handleFullscreen}
        className="
          absolute
          top-2
          left-2
          z-20
          px-3
          py-1
          text-xs
          rounded-md
          bg-black/70
          text-white
          border
          border-gray-500
          hover:bg-black
        "
      >
        ⛶ 全画面 (F)
      </button>

      <div
        ref={containerRef}
        className={className}
      >
        {children}
      </div>
    </div>
  );
};

type Tag = {
  name: string;
  yomi: string;
  group: string;
};

timeStamps: [
  {
    label: "イントロ",
    time: 15,
  },
  {
    label: "サビ",
    time: 83,
  },
]

function parseTimeToSeconds(
  value: string,
): number {
  const parts =
    value.split(":").map(Number);

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return (
      parts[0] * 3600 +
      parts[1] * 60 +
      parts[2]
    );
  }

  return 0;
}

function handleAddTimestamp() {
  if (!selectedPage) return;

  const label =
    newTimestampLabel.trim();

  if (!label) return;

  const sec =
    parseTimeToSeconds(
      newTimestampTime,
    );

  setSelectedPage({
    ...selectedPage,
    timeStamps: [
      ...(selectedPage.timeStamps ?? []),
      {
        label,
        time: sec,
      },
    ],
  });

  setNewTimestampLabel("");
  setNewTimestampTime("");
}

function handleDeleteTimestamp(
  index: number,
) {
  if (!selectedPage) return;

  setSelectedPage({
    ...selectedPage,
    timeStamps:
      (
        selectedPage.timeStamps ??
        []
      ).filter(
        (_, i) => i !== index,
      ),
  });
}

export default function Home() {
  const [fixedCategories, setFixedCategories] =
    useState<string[]>([]);
  const [groupedTags, setGroupedTags] =
    useState<Record<string, Tag[]>>({});
  const [allProjectPages, setAllProjectPages] = useState<PageHeader[]>([]); 
  const [filteredPages, setFilteredPages] = useState<PageHeader[]>([]);   
  const [displayedPages, setDisplayedPages] = useState<PageHeader[]>([]);  

  const [viewMode, setViewMode] = useState<ViewMode>('MAIN_LIST');
  const [newTimestampLabel, setNewTimestampLabel] =
    useState("");
  const [newTimestampTime, setNewTimestampTime] =
    useState("");
  const [selectedPage, setSelectedPage] = useState<PageHeader | null>(null);
  const [isFading, setIsFading] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<number | null>(null);
  const [currentProject, setCurrentProject] = useState<string>('mx-music');
  const [isVideoLoaded, setIsVideoLoaded] = useState<boolean>(false);

  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('TITLE');
  const [sortMode, setSortMode] =
  useState<SortMode>('NEWEST');

  const [randomOrder, setRandomOrder] =
  useState<string[]>([]);

  const [searchQuery, setSearchQuery] =
    useState<string>(''); // 入力中テキスト

  const [appliedTitleSearch, setAppliedTitleSearch] =
    useState<string>(''); // Enter確定済み検索

  const searchInputRef =
    useRef<HTMLInputElement>(null);

  const [uniqueTags, setUniqueTags] = useState<string[]>([]);
  const [tagCounts, setTagCounts] = useState<{ [key: string]: number }>({});

  const [isSelectMode, setIsSelectMode] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const [history, setHistory] = useState<HistoryState[]>([
    { viewMode: 'MAIN_LIST', selectedPage: null, selectedTag: null, selectedStatus: null, project: 'mx-music' }
  ]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  const listScrollPositions = useRef<{ [key: string]: number }>({});
  const detailScrollPositions = useRef<{ [key: number]: number }>({});

  const [displayCount, setDisplayCount] = useState<number>(100);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const stateRef = useRef({ viewMode, selectedPage, selectedTag, selectedStatus, currentProject, historyIndex, history });
  const handlersRef = useRef({
    executeGoBack: () => {},
    executeGoForward: () => {}
  });

  const shuffleArray = <T,>(array: T[]) => {
    const arr = [...array];

    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(
        Math.random() * (i + 1)
      );

      [arr[i], arr[j]] =
        [arr[j], arr[i]];
    }

    return arr;
  };

  useEffect(() => {
    const loadTags = async () => {
      try {
        const tags = (await GetTags()) ?? [];
        const fixed = await GetFixedTags();

        setFixedCategories(fixed ?? []);

        const grouped =
          tags.reduce((acc, tag) => {
            if (!acc[tag.group]) {
              acc[tag.group] = [];
            }

            acc[tag.group].push(tag);

            return acc;
          }, {} as Record<string, Tag[]>);

        setGroupedTags(grouped);
      } catch (err) {
        console.error(
          "タグ取得失敗",
          err
        );
      }
    };

    loadTags();
  }, [currentProject]);

  useEffect(() => {
    stateRef.current = { viewMode, selectedPage, selectedTag, selectedStatus, currentProject, historyIndex, history };
  });

  useEffect(() => {
    loadProjectAllPages();
  }, []);

  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  const loadProjectAllPages = () => {
    setIsLoading(true);
    GetAllPageList()
      .then((allList) => {
        const safeList = allList || [];
        setAllProjectPages(safeList);
        setFilteredPages(safeList);
        setDisplayedPages(safeList.slice(0, 100));
        setDisplayCount(100);

        const counts: { [key: string]: number } = {};
        safeList.forEach(p => {
          if (p.tags) {
            p.tags.forEach(t => {
              const lower = t.trim();
              if (lower) counts[lower] = (counts[lower] || 0) + 1;
            });
          }
        });
        setTagCounts(counts);
        setUniqueTags(Object.keys(counts));
      })
      .catch((err) => console.error("データ取得失敗:", err))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (
      isSearchOpen &&
      searchInputRef.current
    ) {
      searchInputRef.current.focus();
    }
  }, [isSearchOpen, searchMode]);

  useEffect(() => {
    if (viewMode !== 'MAIN_LIST' || selectedTag || selectedStatus !== null) return;

    const handleScroll = () => {
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 200) {
        if (displayCount < filteredPages.length) {
          setDisplayCount((prevCount) => {
            const nextCount = prevCount + 100;
            setDisplayedPages(filteredPages.slice(0, nextCount));
            return nextCount;
          });
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [displayCount, filteredPages, viewMode, selectedTag, selectedStatus]);

  useEffect(() => {
    const filtered = allProjectPages.filter(
      (item) => {
        const matchesSearch =
          searchQuery.trim() === ''
            ? true
            : item.title
                .toLowerCase()
                .includes(
                  searchQuery.toLowerCase()
                );

        const matchesTag =
          selectedTag
            ? item.tags?.some(
                (t) =>
                  t.toLowerCase() ===
                  selectedTag.toLowerCase()
              )
            : true;

        const matchesStatus =
          selectedStatus !== null
            ? item.statusId ===
              selectedStatus
            : true;

        return (
          matchesSearch &&
          matchesTag &&
          matchesStatus
        );
      }
    );

    let sorted = [...filtered];

    switch (sortMode) {
      case 'NEWEST':
      sorted.sort(
        (a, b) => b.sortId - a.sortId
      );
      break;

    case 'OLDEST':
      sorted.sort(
        (a, b) => a.sortId - b.sortId
      );
      break;

      case 'TITLE_ASC':
        sorted.sort((a, b) =>
          a.title.localeCompare(
            b.title,
            'ja',
            { sensitivity: 'base' }
          )
        );
        break;

      case 'TITLE_DESC':
        sorted.sort((a, b) =>
          b.title.localeCompare(
            a.title,
            'ja',
            { sensitivity: 'base' }
          )
        );
        break;

      case 'RANDOM':
        if (randomOrder.length === 0) {
          const shuffled =
            shuffleArray(sorted);

          const ids = shuffled.map(
            (p) => p.id
          );

          setRandomOrder(ids);

          sorted = shuffled;
        } else {
          const orderMap =
            new Map(
              randomOrder.map(
                (id, index) => [
                  id,
                  index,
                ]
              )
            );

          sorted.sort((a, b) => {
            const aIdx =
              orderMap.get(a.id) ??
              Infinity;

            const bIdx =
              orderMap.get(b.id) ??
              Infinity;

            return aIdx - bIdx;
          });
        }
        break;
    }

    setFilteredPages(sorted);

    if (
      selectedTag ||
      selectedStatus !== null
    ) {
      setDisplayedPages(sorted);
    } else {
      setDisplayedPages(
        sorted.slice(0, 100)
      );

      setDisplayCount(100);
    }
  }, [
    searchQuery,
    selectedTag,
    selectedStatus,
    allProjectPages,
    sortMode,
    randomOrder
  ]);

  const getListCacheKey = (mode: ViewMode, tag: string | null, status: number | null, project: string) => {
    return `${mode}_${tag || ''}_${status !== null ? status : 'all'}_${project}`;
  };

  const saveCurrentScrollPosition = (idx: number, mode: ViewMode, tag: string | null, status: number | null, project: string) => {
    if (mode === 'DETAIL') {
      detailScrollPositions.current[idx] = window.scrollY;
    } else {
      const cacheKey = getListCacheKey(mode, tag, status, project);
      listScrollPositions.current[cacheKey] = window.scrollY;
    }
  };

  const applyHistoryState = (state: HistoryState, targetIdx: number, isNewClick: boolean) => {
    setViewMode(state.viewMode);
    setSelectedPage(state.selectedPage);
    setSelectedTag(state.selectedTag);
    setSelectedStatus(state.selectedStatus);
    setCurrentProject(state.project);

    if (isNewClick) {
      setTimeout(() => {
        window.scrollTo(0, 0);
      }, 20);
    } else {
      let targetScrollTop = 0;
      if (state.viewMode === 'DETAIL') {
        targetScrollTop = detailScrollPositions.current[targetIdx] || 0;
      } else {
        const cacheKey = getListCacheKey(state.viewMode, state.selectedTag, state.selectedStatus, state.project);
        targetScrollTop = listScrollPositions.current[cacheKey] || 0;
      }

      let attempts = 0;
      const retryScroll = () => {
        window.scrollTo(0, targetScrollTop);
        attempts++;
        if (attempts < 8) {
          setTimeout(retryScroll, 40);
        }
      };
      setTimeout(retryScroll, 40);
    }
  };

  const executeGoBack = (currentIdx: number, currentHistory: HistoryState[]) => {
    if (currentIdx > 0) {
      const currentSnapshot = stateRef.current;
      saveCurrentScrollPosition(currentIdx, currentSnapshot.viewMode, currentSnapshot.selectedTag, currentSnapshot.selectedStatus, currentSnapshot.currentProject);

      setIsVideoLoaded(false);
      setIsFading(true);
      setTimeout(() => {
        const prevIdx = currentIdx - 1;
        setHistoryIndex(prevIdx);
        const prevState = currentHistory[prevIdx];
        
        if (prevState.project !== currentSnapshot.currentProject) {
          setIsFading(false);
          setIsVideoLoaded(true);
          return;
        }

        applyHistoryState(prevState, prevIdx, false); 
        setTimeout(() => {
          setIsFading(false);
          setIsVideoLoaded(true);
         }, 50);
      }, 150);
    }
  };

  const executeGoForward = (currentIdx: number, currentHistory: HistoryState[]) => {
    if (currentIdx < currentHistory.length - 1) {
      const currentSnapshot = stateRef.current;
      saveCurrentScrollPosition(currentIdx, currentSnapshot.viewMode, currentSnapshot.selectedTag, currentSnapshot.selectedStatus, currentSnapshot.currentProject);

      setIsVideoLoaded(false);
      setIsFading(true);
      setTimeout(() => {
        const nextIdx = currentIdx + 1;
        setHistoryIndex(nextIdx);
        const nextState = currentHistory[nextIdx];

        if (nextState.project !== currentSnapshot.currentProject) {
          setIsFading(false);
          setIsVideoLoaded(true);
          return;
        }

        applyHistoryState(nextState, nextIdx, false); 
        setTimeout(() => {
          setIsFading(false);
          setIsVideoLoaded(true);
        }, 50);
      }, 150);
    }
  };

  useEffect(() => {
    handlersRef.current = {
      executeGoBack: () => executeGoBack(stateRef.current.historyIndex, stateRef.current.history),
      executeGoForward: () => executeGoForward(stateRef.current.historyIndex, stateRef.current.history)
    };
  });

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 3) { e.preventDefault(); handlersRef.current.executeGoBack(); }
      if (e.button === 4) { e.preventDefault(); handlersRef.current.executeGoForward(); }
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const navigateTo = (nextMode: ViewMode, nextPage: PageHeader | null, nextTag: string | null, nextStatus: number | null, isNewClick: boolean = false) => {
    const currentSnapshot = stateRef.current;
    saveCurrentScrollPosition(currentSnapshot.historyIndex, currentSnapshot.viewMode, currentSnapshot.selectedTag, currentSnapshot.selectedStatus, currentSnapshot.currentProject);

    setIsVideoLoaded(false);
    setIsFading(true);
    
    setTimeout(() => {
      const cleanHistory = currentSnapshot.history.slice(0, currentSnapshot.historyIndex + 1);
      const newState: HistoryState = { viewMode: nextMode, selectedPage: nextPage, selectedTag: nextTag, selectedStatus: nextStatus, project: currentSnapshot.currentProject };
      
      const newHistory = [...cleanHistory, newState];
      const newIdx = cleanHistory.length;

      setHistory(newHistory);
      setHistoryIndex(newIdx);
      applyHistoryState(newState, newIdx, isNewClick);
      
      setTimeout(() => {
        setIsFading(false);
        setIsVideoLoaded(true);
      }, 50);
    }, 150);
  };

  const handleProjectChange = async (projectName: string) => {
    setIsFading(true);
    setIsVideoLoaded(false);

    let password = "";

    // secretのみパスワード入力
    if (projectName === "mx-secret") {
      const input = window.prompt(
        "mx-secret のパスワードを入力してください"
      );

      // キャンセル
      if (input === null) {
        setIsFading(false);
        setIsVideoLoaded(true);
        return;
      }

      password = input;
    }

    try {
      const success = await SwitchProject(
        projectName,
        password
      );

      if (!success) {
        alert("パスワードが違います");
        setIsFading(false);
        setIsVideoLoaded(true);
        return;
      }

      setTimeout(async () => {
        setCurrentProject(projectName);
        setViewMode("MAIN_LIST");
        setSelectedPage(null);
        setSelectedTag(null);
        setSelectedStatus(null);

        setAllProjectPages([]);
        setFilteredPages([]);
        setDisplayedPages([]);

        setUniqueTags([]);
        setTagCounts({});
        setGroupedTags({});

        listScrollPositions.current = {};
        detailScrollPositions.current = {};

        setIsSelectMode(false);
        setSelectedIds(new Set());

        const newInitialState: HistoryState = {
          viewMode: "MAIN_LIST",
          selectedPage: null,
          selectedTag: null,
          selectedStatus: null,
          project: projectName,
        };

        setHistory([newInitialState]);
        setHistoryIndex(0);

        setIsLoading(true);

        try {
          const allList = await GetAllPageList();
          const safeList = allList || [];

          setAllProjectPages(safeList);
          setFilteredPages(safeList);
          setDisplayedPages(safeList.slice(0, 100));
          setDisplayCount(100);

          const counts: { [key: string]: number } = {};

          safeList.forEach((p) => {
            if (p.tags) {
              p.tags.forEach((t) => {
                const lower = t.trim();

                if (lower) {
                  counts[lower] =
                    (counts[lower] || 0) + 1;
                }
              });
            }
          });

          setTagCounts(counts);
          setUniqueTags(Object.keys(counts));
        } catch (err) {
          console.error(
            "新プロジェクトデータ取得失敗:",
            err
          );
        } finally {
          setIsLoading(false);
          setIsFading(false);
        }
      }, 150);
    } catch (err) {
      console.error(
        "プロジェクト切り替え失敗:",
        err
      );

      alert("パスワードが違います");
      setIsFading(false);
      setIsVideoLoaded(true);
    }
  };

  const handleCardClick = (p: PageHeader) => {
    if (isSelectMode) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(p.id)) next.delete(p.id);
        else next.add(p.id);
        return next;
      });
    } else {
      handleSelectPage(p);
    }
  };

  const handleCardContextMenu = (e: React.MouseEvent, p: PageHeader) => {
    if (!isSelectMode) return;
    e.preventDefault();
    if (!selectedIds.has(p.id)) {
      setSelectedIds((prev) => new Set(prev).add(p.id));
    }
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleBulkStatusChange = (newStatusId: number) => {
    if (selectedIds.size === 0) return;
    setIsLoading(true);

    const promises = Array.from(selectedIds).map((id) => UpdatePageStatus(id, newStatusId));

    Promise.all(promises)
      .then(() => {
        setAllProjectPages((prev) =>
          prev.map((p) => (selectedIds.has(p.id) ? { ...p, statusId: newStatusId } : p))
        );
        setHistory((prevHis) =>
          prevHis.map((h) =>
            h.selectedPage && selectedIds.has(h.selectedPage.id)
              ? { ...h, selectedPage: { ...h.selectedPage, statusId: newStatusId } }
              : h
          )
        );
        setSelectedIds(new Set());
        setIsSelectMode(false);
      })
      .catch((err) => console.error("一括ステータス更新失敗:", err))
      .finally(() => setIsLoading(false));
  };

  const handleSelectPage = (page: PageHeader) => navigateTo('DETAIL', page, selectedTag, selectedStatus, true);
  const handleGoToMainList = () => navigateTo('MAIN_LIST', null, selectedTag, selectedStatus, true);
  const handleTagClick = (
    tag: string
  ) => {
    setAppliedTitleSearch('');
    setSearchQuery('');

    navigateTo(
      'MAIN_LIST',
      null,
      tag,
      selectedStatus,
      true
    );

    setIsSearchOpen(false);
  };
  const handleClearTagFilter = () => navigateTo('MAIN_LIST', null, null, selectedStatus, true);
  const handleStatusFilterChange = (status: number | null) => navigateTo('MAIN_LIST', null, selectedTag, status, true);

  const handleStatusChange = (newStatusId: number) => {
    if (!selectedPage) return;
    UpdatePageStatus(selectedPage.id, newStatusId)
      .then((success) => {
        if (success) {
          const updated = { ...selectedPage, statusId: newStatusId };
          setSelectedPage(updated);
          setAllProjectPages((prev) => prev.map(p => p.id === selectedPage.id ? { ...p, statusId: newStatusId } : p));
          setHistory((prevHis) => prevHis.map(h => h.selectedPage?.id === selectedPage.id ? { ...h, selectedPage: updated } : h));
        }
      })
      .catch((err) => console.error("ステータス更新失敗:", err));
  };

  const handleExecuteTitleSearch = () => {
    const query = searchQuery.trim();

    setAppliedTitleSearch(query);
    setSelectedTag(null);

    setIsSearchOpen(false);
  };

  const handleClearSearch = () => {
    setAppliedTitleSearch('');
    setSearchQuery('');
    setSelectedTag(null);
  };

  const getRelatedPagesByTag = (tag: string) => {
    if (!selectedPage) return [];
    return allProjectPages.filter(p => p.id !== selectedPage.id && p.tags && p.tags.includes(tag));
  };

  const renderEmbeddedContent = (
    url: string
  ) => {
    if (!isVideoLoaded) {
      return (
        <div className="aspect-video w-full overflow-hidden rounded-md shadow-lg border border-[#4f5764] bg-[#141619] relative flex items-center justify-center">
          <div className="text-xs text-gray-500 font-mono tracking-widest animate-pulse">
            CONTENT INITIALIZING...
          </div>
        </div>
      );
    }

    const lowerUrl =
      url.toLowerCase();

    //
    // 1. mp4 / twimg
    //
    if (
      lowerUrl.includes(
        'twimg.com'
      ) ||
      lowerUrl.endsWith('.mp4') ||
      lowerUrl.endsWith('.webm') ||
      lowerUrl.endsWith('.ogv')
    ) {
      return (
        <VideoPlayer url={url} />
      );
    }

    //
    // 2. YouTube
    //
    const ytRegex =
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/i;

    const ytMatch =
      url.match(ytRegex);

    if (ytMatch) {
      const videoId =
        ytMatch[1];

      return (
        <FullscreenContainer className="aspect-video w-full rounded-md overflow-hidden">
          <iframe
            className="w-full h-full"
            src={`https://www.youtube.com/embed/${videoId}`}
          />
        </FullscreenContainer>
      );
    }

    //
    // 3. ニコニコ
    //
    const nicoRegex =
      /nicovideo\.jp\/watch\/(sm\d+|\d+)/i;

    const nicoMatch =
      url.match(nicoRegex);

    if (nicoMatch) {
      return (
        <FullscreenContainer className="aspect-video w-full rounded-md overflow-hidden">
          <iframe
            className="w-full h-full"
            src={`https://embed.nicovideo.jp/watch/${nicoMatch[1]}`}
            allowFullScreen
          />
        </FullscreenContainer>
      );
    }

    //
    // 4. Spotify
    //
    if (
      lowerUrl.includes(
        'spotify.com'
      )
    ) {
      const embedUrl =
        url.replace(
          'open.spotify.com/intl-ja/',
          'open.spotify.com/embed/'
        );

      return (
        <FullscreenContainer className="w-full h-[420px] rounded-md overflow-hidden">
          <iframe
            className="w-full h-full"
            src={embedUrl}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen"
          />
        </FullscreenContainer>
      );
    }

    //
    // 5. Instagram
    //
    if (
      lowerUrl.includes(
        'instagram.com'
      )
    ) {
      const clean =
        url
          .split('?')[0]
          .replace(/\/$/, '');

      return (
        <FullscreenContainer className="w-full h-[800px] rounded-md overflow-hidden">
          <iframe
            className="w-[600px] h-full bg-white flex items-center justify-center mx-auto"
            src={`${clean}/embed`}
          />
        </FullscreenContainer>
      );
    }

    //
    // 6. X / Twitter
    //
    if (
      lowerUrl.includes('x.com') ||
      lowerUrl.includes('twitter.com')
    ) {
      return (
        <div className="bg-[#141619] border border-[#4f5764] rounded-md p-4">
          <TwitterEmbed
            url={url}
          />
        </div>
      );
    }

    //
    // 7. 音声
    //
    if (
      lowerUrl.endsWith('.mp3') ||
      lowerUrl.endsWith('.wav') ||
      lowerUrl.endsWith('.ogg') ||
      lowerUrl.endsWith('.m4a')
    ) {
      return (
        <div className="bg-[#1e2126] p-6 rounded-md border border-[#4f5764]">
          <audio
            controls
            className="w-full"
            src={url}
          />
        </div>
      );
    }

    //
    // 8. 画像
    //
    if (
      /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(
        lowerUrl
      )
    ) {
      return (
        <div className="bg-[#141619] rounded-md p-2 border border-[#4f5764]">
          <img
            src={url}
            className="max-w-full max-h-[700px] mx-auto object-contain"
          />
        </div>
      );
    }

    //
    // 9. Amazon
    //
    if (
      lowerUrl.includes(
        'amazon.'
      )
    ) {
      return (
        <div className="bg-[#1e2126] rounded-md p-6 border border-[#4f5764]">
          <div className="text-sm text-gray-300">
            Amazon は
            iframe埋め込み制限のため
            内部表示できません
          </div>

          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-400 underline mt-3 inline-block"
          >
            Amazonを開く →
          </a>
        </div>
      );
    }

    //
    // 10. 一般サイト
    //
    return (
      <FullscreenContainer className="w-full h-[800px] rounded-md overflow-hidden">
        <iframe
          className="w-full h-full bg-white"
          src={url}
          sandbox="
            allow-scripts
            allow-same-origin
            allow-forms
            allow-popups
          "
        />
      </FullscreenContainer>
    );
  };

  const filteredSearchTitles =
    searchQuery.trim() === ''
      ? []
      : allProjectPages
          .filter((p) =>
            p.title
              .toLowerCase()
              .includes(
                searchQuery.toLowerCase()
              )
          )
          .slice(0, 50);
  const filteredSearchTags = searchQuery.trim() === '' ? [] : uniqueTags.filter(tag =>
    tag.toLowerCase().includes(searchQuery.toLowerCase())
  );

const classificationTags =
  fixedCategories.filter(cat =>
    uniqueTags.some(
      t =>
        t.toLowerCase() ===
        cat.toLowerCase()
    )
  );

const artistTags =
  uniqueTags
    .filter(
      tag =>
        !fixedCategories.some(
          cat =>
            cat.toLowerCase() ===
            tag.toLowerCase()
        )
    )
    .sort((a, b) =>
      a.localeCompare(
        b,
        'ja',
        { sensitivity: 'base' }
      )
    );

  // mp4サムネキャッシュ（メモリのみ）
  const [runtimeThumbMap, setRuntimeThumbMap] = useState<Record<string, string>>({});

  const generatingThumbsRef = useRef<Set<string>>(new Set());

  const createVideoThumbnail = useCallback(async (url: string): Promise<string | null> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');

      video.crossOrigin = 'anonymous';
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      video.src =
        `http://localhost:54321/video?url=${encodeURIComponent(url)}`;

      const cleanup = () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      };

      video.onloadedmetadata = () => {
        try {
          // 真っ黒回避
          video.currentTime = Math.min(
            0.2,
            Math.max(0, (video.duration || 1) - 0.1)
          );
        } catch {
          cleanup();
          resolve(null);
        }
      };

      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');

          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 360;

          const ctx = canvas.getContext('2d');

          if (!ctx) {
            cleanup();
            resolve(null);
            return;
          }

          ctx.drawImage(video, 0, 0);

          const dataUrl = canvas.toDataURL(
            'image/jpeg',
            0.75
          );

          cleanup();
          resolve(dataUrl);
        } catch (e) {
          console.error('thumbnail create error', e);
          cleanup();
          resolve(null);
        }
      };

      video.onerror = (e) => {
        console.error('thumbnail video error', e);
        cleanup();
        resolve(null);
      };
    });
  }, []);

  useEffect(() => {
    const generateThumbs = async () => {
      const candidates = displayedPages.filter((p) => {
        const lowerUrl = p.url.toLowerCase();

        const isVideo =
          lowerUrl.includes('twimg.com') ||
          lowerUrl.endsWith('.mp4') ||
          lowerUrl.endsWith('.webm') ||
          lowerUrl.endsWith('.ogv');

        return (
          isVideo &&
          !p.thumbnailUrl &&
          !runtimeThumbMap[p.id] &&
          !generatingThumbsRef.current.has(p.id)
        );
      });

      // 一気にやると重いので最大3並列
      const limited = candidates.slice(0, 3);

      for (const page of limited) {
        generatingThumbsRef.current.add(page.id);

        try {
          const thumb = await createVideoThumbnail(page.url);

          if (thumb) {
            setRuntimeThumbMap((prev) => ({
              ...prev,
              [page.id]: thumb,
            }));
          }
        } finally {
          generatingThumbsRef.current.delete(page.id);
        }
      }
    };

    generateThumbs();
  }, [displayedPages, runtimeThumbMap, createVideoThumbnail]);
  
  const seenVideoIds = new Set<string>();

  return (
    <div className="relative min-h-screen bg-[#1a1c20]">
      <div className={`fixed inset-0 bg-[#111215] z-50 pointer-events-none transition-opacity duration-150 ease-in-out ${isFading ? 'opacity-100' : 'opacity-0'}`} />

      <div className="bg-[#16181b] border-b-2 border-[#404650] px-6 py-3 flex items-center justify-between sticky top-0 z-40 shadow-xl">
        <div className="flex items-center gap-4 flex-grow max-w-3xl">
          <div className="flex items-center gap-2">
            <button onClick={() => executeGoBack(historyIndex, history)} disabled={historyIndex === 0} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors border ${historyIndex === 0 ? 'text-gray-600 border-gray-800 cursor-not-allowed' : 'text-white bg-[#2c3038] border-[#4f5764] hover:bg-[#3d434e]'}`} title="戻る">◀</button>
            <button onClick={() => executeGoForward(historyIndex, history)} disabled={historyIndex === history.length - 1} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors border ${historyIndex === history.length - 1 ? 'text-gray-600 border-gray-800 cursor-not-allowed' : 'text-white bg-[#2c3038] border-[#4f5764] hover:bg-[#3d434e]'}`} title="進む">▶</button>
          </div>

          <div onClick={() => setIsSearchOpen(true)} className="flex-grow bg-[#141619] border border-[#474f5c] hover:border-[#5cc3f6] rounded-md px-3 py-1.5 flex items-center justify-between cursor-pointer transition-colors shadow-inner text-gray-500 group">
            <div className="flex items-center gap-2 text-sm">
              <span>🔍</span>
              <span className="group-hover:text-gray-300 transition-colors"></span>
            </div>
            <span className="text-[10px] bg-[#23262d] text-gray-400 font-mono px-1.5 py-0.5 rounded border border-[#3d434e] shadow-sm font-bold">Ctrl + K</span>
          </div>
          
          <div className="flex items-center gap-2 bg-[#1b1e22] border border-[#474f5c] px-3 py-1.5 rounded-md shadow-inner shrink-0">
            <label className="text-[11px] font-bold text-gray-400 font-sans tracking-wider">Status:</label>
            <select 
              value={selectedStatus !== null ? selectedStatus : 'all'} 
              onChange={(e) => handleStatusFilterChange(e.target.value === 'all' ? null : Number(e.target.value))} 
              className={`bg-transparent font-extrabold text-sm outline-none cursor-pointer tracking-wide border-0 p-0 pr-4 focus:ring-0 font-sans ${selectedStatus !== null ? STATUS_MAP[selectedStatus].color : 'text-white'}`}
            >
              <option value="all" className="bg-[#23262d] text-white font-bold">🔘 全て表示</option>
              <option value={0} className="bg-[#23262d] text-gray-400 font-bold">⚪ 未試聴</option>
              <option value={1} className="bg-[#23262d] text-blue-400 font-bold">🔵 登録予定</option>
              <option value={2} className="bg-[#23262d] text-red-400 font-bold">🔴 削除予定</option>
              <option value={3} className="bg-[#23262d] text-green-400 font-bold">🟢 登録済</option>
            </select>
          </div>

          <div className="flex items-center gap-2 bg-[#1b1e22] border border-[#474f5c] px-3 py-1.5 rounded-md shadow-inner shrink-0">
            <label className="text-[11px] font-bold text-gray-400 font-sans tracking-wider">
              Sort:
            </label>

            <select
              value={sortMode}
              onChange={(e) => {
                const next =
                  e.target.value as SortMode;

                setSortMode(next);

                if (next !== 'RANDOM') {
                  setRandomOrder([]);
                }
              }}
              className="
                bg-transparent
                font-extrabold
                text-sm
                outline-none
                cursor-pointer
                tracking-wide
                border-0
                p-0
                pr-4
                focus:ring-0
                font-sans
                text-white
              "
            >
              <option
                value="NEWEST"
                className="bg-[#23262d] text-white font-bold"
              >
                🆕 新しい順
              </option>

              <option
                value="OLDEST"
                className="bg-[#23262d] text-white font-bold"
              >
                📜 古い順
              </option>

              <option
                value="TITLE_ASC"
                className="bg-[#23262d] text-white font-bold"
              >
                🔤 タイトル順
              </option>

              <option
                value="TITLE_DESC"
                className="bg-[#23262d] text-white font-bold"
              >
                🔠 タイトル逆順
              </option>

              <option
                value="RANDOM"
                className="bg-[#23262d] text-white font-bold"
              >
                🎲 ランダム
              </option>
            </select>

            {sortMode === 'RANDOM' && (
              <button
                onClick={() => {
                  const shuffled =
                    shuffleArray(
                      filteredPages
                    );

                  setRandomOrder(
                    shuffled.map(
                      (p) => p.id
                    )
                  );
                }}
                className="
                  text-xs
                  px-2
                  py-1
                  rounded-md
                  bg-[#4b3b67]
                  hover:bg-[#5a4677]
                  text-white
                  transition-colors
                "
              >
                🔀
              </button>
            )}
          </div>

          {(selectedTag ||
            appliedTitleSearch) && (
            <div className="flex items-center gap-2 bg-[#252930] border-2 border-[#5cc3f6] px-3 py-1 rounded-md text-sm shadow-inner shrink-0">
              <span className="text-gray-400 text-xs font-bold">
                絞り込み:
              </span>

              {appliedTitleSearch && (
                <span className="text-[#5cc3f6] font-black tracking-wider">
                  🔍 {appliedTitleSearch}
                </span>
              )}

              {selectedTag && (
                <span className="text-[#5cc3f6] font-black tracking-wider">
                  🏷️ {selectedTag}
                </span>
              )}

              <button
                onClick={handleClearSearch}
                className="text-gray-400 hover:text-red-400 ml-1.5 font-bold text-xs bg-[#16181b] w-4 h-4 rounded-full flex items-center justify-center border border-[#404650]"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 shrink-0 ml-4">
          {viewMode === 'MAIN_LIST' && (
            <button
              onClick={() => {
                setIsSelectMode(!isSelectMode);
                setSelectedIds(new Set());
              }}
              className={`px-4 py-1.5 rounded-md text-xs font-bold tracking-wider border transition-all ${
                isSelectMode
                  ? 'bg-violet-500/20 text-violet-200 border-violet-400 shadow-[0_0_12px_rgba(139,92,246,0.15)] font-black'
                  : 'bg-[#2c3038] text-violet-300 border-violet-500/30 hover:bg-[#343944] hover:border-violet-400 hover:text-violet-200'
              }`}
            >
              {isSelectMode ? `選択解除 (${selectedIds.size}件)` : '☑ 複数一括変更'}
            </button>
          )}

          <button
            onClick={() => navigateTo(viewMode === 'TAG_LIST' ? 'MAIN_LIST' : 'TAG_LIST', null, null, selectedStatus, true)}
            className={`px-4 py-1.5 rounded-md text-xs font-bold tracking-wider border transition-all ${viewMode === 'TAG_LIST' ? 'bg-[#5cc3f6] text-[#141619] border-[#5cc3f6] font-black' : 'bg-[#2c3038] text-gray-200 border-[#4f5764] hover:bg-[#3d434e]'}`}
          >
            {viewMode === 'TAG_LIST' ? '🎵 一覧に戻る' : '🏷️ タグ一覧を開く'}
          </button>

          <div className="flex items-center gap-2 bg-[#1b1e22] border border-[#474f5c] px-3 py-1.5 rounded-md shadow-inner shrink-0">
            <label className="text-[11px] font-bold text-gray-400 font-sans tracking-wider">
              Project:
            </label>

            <select
              value={currentProject}
              onChange={(e) => handleProjectChange(e.target.value)}
              className="bg-transparent font-extrabold text-sm outline-none cursor-pointer tracking-wide border-0 p-0 pr-4 focus:ring-0 font-sans text-white"
            >
              <option value="mx-music" className="bg-[#23262d] text-white font-bold">
                mx-music
              </option>

              <option value="mx-streaming" className="bg-[#23262d] text-white font-bold">
                mx-streaming
              </option>

              <option value="mx-anomaly" className="bg-[#23262d] text-white font-bold">
                mx-anomaly
              </option>

              <option value="mx-other" className="bg-[#23262d] text-white font-bold">
                mx-other
              </option>

              <option value="mx-tmp" className="bg-[#23262d] text-white font-bold">
                mx-tmp
              </option>
              <option value="mx-secret">
                mx-secret
              </option>
            </select>
          </div>
        </div>
      </div>

      {/* 🔍 検索モーダル */}
      {isSearchOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-center pt-[10vh] px-4">
          <div className="absolute inset-0" onClick={() => setIsSearchOpen(false)} />
          <div className="bg-[#1f2228] border-2 border-[#474f5c] w-full max-w-2xl rounded-xl shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[70vh]">
            <div className="flex border-b border-[#343944] bg-[#16181b]">
              <button onClick={() => setSearchMode('TITLE')} className={`flex-1 py-3 text-sm font-bold tracking-wider transition-colors ${searchMode === 'TITLE' ? 'text-[#5cc3f6] bg-[#1f2228] border-b-2 border-[#5cc3f6]' : 'text-gray-400 hover:text-white'}`}>📝 タイトルで検索</button>
              <button onClick={() => setSearchMode('TAG')} className={`flex-1 py-3 text-sm font-bold tracking-wider transition-colors ${searchMode === 'TAG' ? 'text-[#5cc3f6] bg-[#1f2228] border-b-2 border-[#5cc3f6]' : 'text-gray-400 hover:text-white'}`}>🏷️ タグで検索</button>
            </div>
            <div className="p-4 bg-[#1b1d22] border-b border-[#343944] flex items-center gap-3">
              <span className="text-xl">🔍</span>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) =>
                  setSearchQuery(e.target.value)
                }
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    searchMode === 'TITLE'
                  ) {
                    handleExecuteTitleSearch();
                  }
                }}
                placeholder={
                  searchMode === 'TITLE'
                    ? 'タイトルを入力してEnter...'
                    : 'タグを選択してください...'
                }
                className="w-full bg-transparent border-0 outline-none text-white placeholder-gray-500 font-medium text-base focus:ring-0"
              />
              <button onClick={() => setIsSearchOpen(false)} className="text-xs text-gray-500 hover:text-gray-300 font-mono bg-[#16181b] border border-[#343944] px-2 py-1 rounded">ESC</button>
            </div>
            <div className="overflow-y-auto flex-grow p-2 space-y-1 bg-[#1f2228]">
              {searchQuery.trim() === '' ? (
                <div className="text-center py-8 text-gray-500 text-xs font-mono">キーワードを入力すると候補が出ます</div>
              ) : searchMode === 'TITLE' ? (
                filteredSearchTitles.length === 0 ? <div className="text-center py-8 text-gray-500 text-xs font-mono">一致するタイトルがありません</div> :
                filteredSearchTitles.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => {
                      setIsSearchOpen(false);
                      handleSelectPage(p);
                    }} className="p-3 rounded-lg hover:bg-[#2a2f3a] border border-transparent hover:border-[#474f5c] transition-all cursor-pointer flex items-center justify-between group">
                    <div className="flex flex-col gap-1 pr-4">
                      <span className="text-sm font-bold text-gray-200 group-hover:text-[#5cc3f6] line-clamp-1">{p.title}</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {p.tags?.slice(0, 3).map((t, idx) => <span key={idx} className="text-[10px] bg-[#141619] text-gray-400 border border-[#343944] px-1.5 py-0.5 rounded font-sans">{t}</span>)}
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${STATUS_MAP[p.statusId]?.border} ${STATUS_MAP[p.statusId]?.color} shrink-0 font-mono`}>{STATUS_MAP[p.statusId]?.label}</span>
                  </div>
                ))
              ) : (
                filteredSearchTags.length === 0 ? <div className="text-center py-8 text-gray-500 text-xs font-mono">一致するタグがありません</div> :
                filteredSearchTags.map((tag, idx) => (
                  <div key={idx} onClick={() => { setIsSearchOpen(false); handleTagClick(tag); }} className="p-3 rounded-lg hover:bg-[#2a2f3a] border border-transparent hover:border-[#474f5c] transition-all cursor-pointer flex items-center justify-between group">
                    <div className="flex items-center gap-2"><span className="text-base text-[#5cc3f6]">🏷️</span><span className="text-sm font-extrabold text-gray-200 group-hover:text-[#5cc3f6] tracking-wider">{tag}</span></div>
                    <span className="text-[11px] text-gray-500 font-mono group-hover:text-gray-300">このタグで絞り込む ➔</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* タグ一覧画面 */}
      {viewMode === 'TAG_LIST' && (
        <div className="p-6 text-gray-200 antialiased max-w-[96%] mx-auto animate-fadeIn">
          <div className="flex justify-between items-center mb-8 border-b-2 border-[#3d434e] pb-4">
            <h1 className="text-2xl font-bold tracking-wider text-white">🏷️ タグ管理インデックス <span className="text-xs font-mono text-gray-400">({uniqueTags.length} 種類のタグを検出)</span></h1>
          </div>

          <div className="mb-10 bg-[#23262d] border-2 border-[#474f5c] rounded-xl p-6 shadow-xl">
            <h2 className="text-sm font-black text-[#5cc3f6] tracking-widest mb-4 border-b border-[#3d434e] pb-2 flex items-center gap-2">📁 分類タグ（固定指定）</h2>
            <div className="flex flex-wrap gap-4">
              {fixedCategories.map((cat, idx) => {
                const count = tagCounts[cat.toLowerCase()] || tagCounts[cat] || 0; 
                const hasTag = classificationTags.some(t => t.toLowerCase() === cat.toLowerCase());
                return (
                  <div key={idx} onClick={() => hasTag && handleTagClick(cat)} className={`px-5 py-3 rounded-lg border-2 text-center transition-all ${hasTag ? 'bg-[#1b1d22] border-[#5cc3f6] hover:border-white cursor-pointer group' : 'bg-[#1b1d22]/40 border-gray-800 text-gray-600 cursor-not-allowed'}`}>
                    <div className={`font-black text-sm tracking-wider ${hasTag ? 'text-white group-hover:text-[#5cc3f6]' : 'text-gray-600'}`}>{cat}</div>
                    <div className="text-[10px] font-mono font-bold mt-1 text-gray-400">{count} 本のアイテム</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className="
              fixed
              right-4
              top-1/2
              -translate-y-1/2
              z-30
              bg-[#1e2127]
              border
              border-[#474f5c]
              rounded-xl
              p-2
              shadow-2xl
              flex
              flex-col
              gap-1
            "
          >
            {kanaList.map((k) => (
              <button
                key={k}
                onClick={() =>
                  document
                    .getElementById(`kana-${k}`)
                    ?.scrollIntoView({
                      behavior: 'smooth',
                    })
                }
                className="
                  w-10 h-8
                  rounded-md
                  text-sm
                  font-bold
                  bg-[#262a31]
                  hover:bg-[#3b4048]
                  hover:text-[#5cc3f6]
                  transition-colors
                "
              >
                {k}
              </button>
            ))}
          </div>

          {kanaList.map((kana) => (
            <div
              key={kana}
              id={`kana-${kana}`}
              className="
                mb-8
                scroll-mt-28
                rounded-lg
                border
                border-[#4b525f]
                bg-[#2a2f36]
                overflow-hidden
                shadow-lg
              "
            >
              {/* 無骨ヘッダー */}
              <div
                className="
                  px-5
                  py-3
                  border-b-2
                  border-[#404650]
                  bg-[#343a44]
                  flex
                  items-center
                  justify-between
                "
              >
                <div className="flex items-center gap-3">
                  <div
                    className="
                      text-lg
                      font-black
                      text-gray-100
                      tracking-[0.2em]
                      font-mono
                    "
                  >
                    {kana}
                  </div>

                  <div
                    className="
                      h-4
                      w-[1px]
                      bg-[#606775]
                    "
                  />

                  <div
                    className="
                      text-[11px]
                      uppercase
                      tracking-[0.2em]
                      text-gray-400
                      font-bold
                    "
                  >
                  </div>
                </div>

                <div className="text-[11px] font-mono text-gray-400">
                  {groupedTags[kana]?.length ?? 0} tags
                </div>
              </div>

              {/* タグ一覧 */}
              <div className="p-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3">
                  {groupedTags[kana]?.map((tag) => {
                    const count = tagCounts[tag.name] || 0;

                    return (
                      <div
                        key={tag.name}
                        onClick={() => handleTagClick(tag.name)}
                        className="
                          bg-[#1b1d22]
                          border
                          border-[#3d434e]
                          hover:border-emerald-400
                          rounded-md
                          px-3
                          py-2
                          flex
                          flex-col
                          justify-between
                          cursor-pointer
                          transition-all
                          hover:shadow-md
                          group
                        "
                      >
                        <span
                          className="
                            text-xs
                            font-bold
                            text-gray-300
                            group-hover:text-emerald-400
                            tracking-wide
                            truncate
                          "
                          title={tag.name}
                        >
                          {tag.name}
                        </span>

                        <span
                          className="
                            text-[10px]
                            font-mono
                            text-gray-500
                            font-bold
                            mt-1
                            text-right
                            group-hover:text-gray-400
                          "
                        >
                          {count} items
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* メイン一覧 */}
      {viewMode === 'MAIN_LIST' && (
        <div className="p-6 text-gray-200 antialiased">
          <div className="max-w-[96%] mx-auto">
            <div className="flex justify-between items-center mb-8 border-b-2 border-[#3d434e] pb-4">
              <h1 className="text-2xl font-bold tracking-wider text-white cursor-pointer" onClick={handleClearTagFilter}>
                {currentProject} <span className="text-sm font-normal text-gray-400">({filteredPages.length} 件のページ)</span>
              </h1>
              {isSelectMode && (
                <div className="text-xs text-violet-300 font-mono tracking-wide animate-pulse">
                  💡 サムネイルを選択し、右クリックでステータス一括メニューを開きます (選択中: {selectedIds.size} 件)
                </div>
              )}
            </div>

            {displayedPages.length === 0 ? (
              <div className="text-center py-20 text-gray-500 font-mono">
                {isLoading ? "データを一括ロード中..." : "該当するページがありません。"}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
                {displayedPages.map((p) => {
                  const isSelected = selectedIds.has(p.id);
                  return (
                    <div 
                      key={p.id} 
                      onClick={() => handleCardClick(p)} 
                      onContextMenu={(e) => handleCardContextMenu(e, p)}
                      className={`bg-[#23262d] border-2 transition-all shadow-lg hover:shadow-2xl rounded-lg overflow-hidden cursor-pointer group flex flex-col h-64 relative select-none
                        ${isSelectMode ? 'hover:border-violet-400' : 'hover:border-[#5cc3f6]'}
                        ${isSelected
                          ? 'border-violet-400 ring-2 ring-violet-500/20 shadow-violet-500/10 bg-violet-500/[0.03]'
                          : (STATUS_MAP[p.statusId]?.border || 'border-[#474f5c]')
                        }
                      `}
                    >
                      {isSelectMode && isSelected && (
                        <div className="absolute top-2 left-2 z-10 bg-violet-500/90 text-violet-100 font-black text-[10px] uppercase px-1.5 py-0.5 rounded shadow shadow-black border border-violet-300/30 font-sans flex items-center gap-1 animate-fadeIn">
                          ✨ SELECTED
                        </div>
                      )}

                      <div className="p-4 flex-grow flex items-start bg-[#2a2e37] border-b border-[#3d434e] relative">
                        <h2 className={`font-bold text-gray-200 line-clamp-2 text-base break-all leading-snug pr-16 ${isSelectMode ? 'group-hover:text-violet-500/90' : 'group-hover:text-[#5cc3f6]'}`}>{p.title || "無題"}</h2>
                        <span className={`absolute top-4 right-4 text-[10px] px-1.5 py-0.5 rounded border ${STATUS_MAP[p.statusId]?.border} ${STATUS_MAP[p.statusId]?.color} ${STATUS_MAP[p.statusId]?.bg} font-mono font-bold shrink-0`}>
                          {STATUS_MAP[p.statusId]?.label}
                        </span>
                      </div>
                      <div className="w-full h-44 bg-[#141619] relative overflow-hidden flex items-center justify-center">
                        {(runtimeThumbMap[p.id] || p.thumbnailUrl) ? (
                          <img
                            src={runtimeThumbMap[p.id] || p.thumbnailUrl}
                            alt={p.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-gray-600 text-xs font-mono gap-2">
                            <div>No Image</div>
                            {(p.url.includes('twimg.com') ||
                              p.url.toLowerCase().endsWith('.mp4')) && (
                              <div className="animate-pulse text-[10px] text-cyan-500">
                                generating...
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {displayCount < filteredPages.length && !selectedTag && selectedStatus === null && <div className="text-center text-sm text-gray-500 my-8 font-mono">さらにスクロールすると自動読み込みします...</div>}
          </div>
        </div>
      )}

      {/* 右クリック時の一括変更カスタムコンテキストメニュー */}
      {isSelectMode && contextMenu && (
        <div 
          className="fixed z-50 bg-[#1f2228] border-2 border-violet-500/90 shadow-2xl rounded-lg py-1.5 w-48 text-left font-sans"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[10px] font-bold text-violet-500/90 border-b border-[#343944] tracking-wider mb-1">
            選択中の {selectedIds.size} 件を一括変更
          </div>
          <button onClick={() => handleBulkStatusChange(0)} className="w-full px-3 py-2 text-xs font-bold text-gray-300 hover:bg-[#2a2f3a] hover:text-white transition-colors flex items-center gap-2">⚪ 未試聴 に変更</button>
          <button onClick={() => handleBulkStatusChange(1)} className="w-full px-3 py-2 text-xs font-bold text-blue-400 hover:bg-[#2a2f3a] transition-colors flex items-center gap-2">🔵 登録予定 に変更</button>
          <button onClick={() => handleBulkStatusChange(2)} className="w-full px-3 py-2 text-xs font-bold text-red-400 hover:bg-[#2a2f3a] transition-colors flex items-center gap-2">🔴 削除予定 に変更</button>
          <button onClick={() => handleBulkStatusChange(3)} className="w-full px-3 py-2 text-xs font-bold text-green-400 hover:bg-[#2a2f3a] transition-colors flex items-center gap-2">🟢 登録済 に変更</button>
        </div>
      )}

      {/* 詳細表示画面 (各メディアに対応したレスポンシブ最適化レイアウト) */}
      {viewMode === 'DETAIL' && selectedPage && (
        <div className="p-6 text-gray-200 antialiased">
          <div className="max-w-[96%] mx-auto mb-5 flex justify-between items-center">
            <button onClick={handleGoToMainList} className="text-xs bg-[#2c3038] border border-[#4f5764] text-gray-200 hover:bg-[#3d434e] px-4 py-2 rounded font-bold transition-colors shadow-md">← 一覧に戻る</button>
          </div>
          <div className="max-w-[96%] mx-auto flex flex-col lg:flex-row gap-6 items-start">
            
            {/* 左側：メインコンテンツ表示領域 (種類に応じてコンポーネントが動的変化) */}
            <div className="flex-grow w-full lg:w-0 space-y-6">
              <div className="bg-[#23262d] shadow-2xl rounded-lg p-6 border-2 border-[#474f5c]">
                <div className="border-b-2 border-[#3d434e] pb-4 mb-6">
                  <h1 className="text-2xl font-bold text-white break-all">{selectedPage.title || "無題"}</h1>
                </div>
                
                {/* 動的埋め込みファクトリの呼び出し */}
                <div className="mb-6">{renderEmbeddedContent(selectedPage.url)}</div>
                
                <div className="pt-2">
                  <h3 className="text-xs font-bold tracking-widest text-gray-400 mb-3">Tags</h3>
                  <div className="flex flex-wrap gap-2.5">
                    {selectedPage.tags && selectedPage.tags.length > 0 ? selectedPage.tags.map((tag, idx) => (
                      <button key={idx} onClick={() => handleTagClick(tag)} className="text-xs font-bold bg-[#141619] border text-[#5cc3f6] hover:bg-[#5cc3f6] hover:text-[#141619] px-3.5 py-1.5 rounded-md tracking-wider transition-all shadow-inner font-sans border-[#5cc3f6]">{tag}</button>
                    )) : <span className="text-xs text-gray-500 italic">タグが登録されていません</span>}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="font-bold mb-2">
                  タイムスタンプ
                </div>

                {(selectedPage.timeStamps ?? []).map(
                  (ts, index) => (
                    <button
                      key={index}
                      className="
                        mr-2
                        mb-2
                        px-2
                        py-1
                        rounded
                        border
                      "
                      onClick={() =>
                        window.open(
                          buildTimestampUrl(
                            selectedPage.url,
                            formatTime(ts.time),
                          ),
                          "_blank",
                        )
                      }
                    >
                      {ts.label}
                    </button>
                  ),
                )}
              </div>

              {/* 関連ページセクション */}
              {selectedPage.tags && selectedPage.tags.length > 0 && (
                <div className="space-y-6">
                  {selectedPage.tags.map((tag, sectionIdx) => {
                    const rawRelatedPages = getRelatedPagesByTag(tag);
                    const relatedPages = rawRelatedPages.filter(p => !seenVideoIds.has(p.id));
                    relatedPages.forEach(p => seenVideoIds.add(p.id));
                    return (
                      <div key={sectionIdx} className="bg-[#1e2127] rounded-lg border-2 border-[#474f5c] overflow-hidden shadow-xl">
                        <div onClick={() => handleTagClick(tag)} className="bg-[#2a2e37] border-b-2 border-[#3d434e] px-4 py-2.5 flex items-center justify-between cursor-pointer hover:bg-[#343944] transition-colors group">
                          <span className="text-sm font-extrabold text-[#5cc3f6] tracking-wider group-hover:text-white">{tag}</span>
                          <span className="text-xs text-gray-400 font-medium font-mono">{relatedPages.length} 件未表示 ➔</span>
                        </div>
                        <div className="p-4 bg-[#181a1f]">
                          {relatedPages.length === 0 ? <p className="text-xs text-gray-500 italic font-mono p-2">このタグを持つ他の新しいコンテンツはありません</p> : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 max-h-[380px] overflow-y-auto p-1">
                              {relatedPages.map((link) => (
                                <div key={link.id} onClick={() => handleSelectPage(link)} className={`bg-[#23262d] border-2 ${STATUS_MAP[link.statusId]?.border || 'border-[#3a404a]'} rounded-lg overflow-hidden cursor-pointer transition-all shadow-md group flex flex-col h-52 relative hover:border-[#5cc3f6]`}>
                                  <div className="p-3 flex-grow flex items-start bg-[#2a2e37] border-b border-[#3d434e] relative">
                                    <h4 className="font-bold text-gray-300 group-hover:text-[#5cc3f6] line-clamp-2 text-xs break-all leading-snug pr-12">{link.title || "無題"}</h4>
                                    <span className={`absolute top-3 right-3 text-[9px] px-1 py-0.2 rounded border ${STATUS_MAP[link.statusId]?.border} ${STATUS_MAP[link.statusId]?.color} ${STATUS_MAP[link.statusId]?.bg} font-mono font-bold shrink-0`}>
                                      {STATUS_MAP[link.statusId]?.label}
                                    </span>
                                  </div>
                                  <div className="w-full h-32 bg-[#141619] relative overflow-hidden flex items-center justify-center">{link.thumbnailUrl ? <img src={link.thumbnailUrl} alt={link.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" /> : <span className="text-xs text-gray-700 font-mono">No Image</span>}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 右側：固定管理パネル設定 */}
            <div className="w-full lg:w-72 flex-shrink-0 bg-[#23262d] border-2 border-[#474f5c] rounded-xl p-5 shadow-2xl lg:sticky lg:top-[68px]">
              <h3 className="text-sm font-bold tracking-wider text-gray-300 mb-4 pb-2 border-b-2 border-[#3d434e]">ページ管理設定</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-2 font-medium">ステータス変更</label>
                  <select value={selectedPage.statusId} onChange={(e) => handleStatusChange(Number(e.target.value))} className="w-full bg-[#141619] text-white text-sm p-2.5 rounded-md border-2 border-[#474f5c] focus:border-[#5cc3f6] outline-none cursor-pointer font-bold transition-colors shadow-inner">
                    <option value={0}>⚪ 未試聴</option>
                    <option value={1}>🔵 登録予定</option>
                    <option value={2}>🔴 削除予定</option>
                    <option value={3}>🟢 登録済</option>
                  </select>
                </div>
                <div className="bg-[#141619] p-3 rounded-md border border-[#3d434e] text-[11px] text-gray-400 space-y-1 font-mono">
                  <div>ID: {selectedPage.id}</div>
                  <div className="text-[10px] text-emerald-400 font-bold mt-2">✓ 変更は自動同期</div>
                </div>
              </div>
              <div className="border-t border-[#3d434e] pt-4">
                <label className="block text-xs text-gray-400 mb-2 font-medium">
                  タイムスタンプ管理
                </label>

                <div className="space-y-2 mb-3">
                  {(selectedPage.timeStamps ?? []).map(
                    (ts, index) => (
                      <div
                        key={index}
                        className="flex gap-2 items-center"
                      >
                        <div className="flex-1 text-xs">
                          {ts.label}
                        </div>

                        <div className="text-xs text-gray-400">
                          {ts.time}s
                        </div>

                        <button
                          onClick={() =>
                            handleDeleteTimestamp(
                              index,
                            )
                          }
                          className="
                            px-2 py-1
                            bg-red-600
                            rounded
                            text-xs
                          "
                        >
                          ×
                        </button>
                      </div>
                    ),
                  )}
                </div>

                <input
                  value={newTimestampLabel}
                  onChange={(e) =>
                    setNewTimestampLabel(
                      e.target.value,
                    )
                  }
                  placeholder="ラベル"
                  className="
                    w-full mb-2 p-2
                    bg-[#141619]
                    border border-[#474f5c]
                    rounded
                    text-sm
                  "
                />

                <input
                  value={newTimestampTime}
                  onChange={(e) =>
                    setNewTimestampTime(
                      e.target.value,
                    )
                  }
                  placeholder="01:23"
                  className="
                    w-full mb-2 p-2
                    bg-[#141619]
                    border border-[#474f5c]
                    rounded
                    text-sm
                  "
                />

                <button
                  onClick={handleAddTimestamp}
                  className="
                    w-full
                    bg-[#5cc3f6]
                    text-black
                    py-2
                    rounded
                    font-bold
                  "
                >
                  追加
                </button>
                <button
                  onClick={async () => {

                    if (!selectedPage) return;

                    await SaveTimeStamps(
                      selectedPage.id,
                      selectedPage.timeStamps ?? [],
                    );

                    alert("保存しました");
                  }}
                  className="
                    mt-2
                    w-full
                    bg-green-600
                    text-white
                    py-2
                    rounded
                    font-bold
                  "
                >
                  保存
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}