import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AtSign, Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAnnotationCtx, DRAFT_KEY } from "../../context/AnnotationContext";
import { useAnnotationRail } from "../../context/AnnotationRailContext";
import CommentThreadCard from "./CommentThreadCard";
import SuggestionCard from "./SuggestionCard";

// Backdrop for the full-height bottom sheet (tapping it closes the sheet). Only rendered in the
// bottom-sheet branch, so it must not be width-gated (the sheet also serves portrait tablets ≥ md).
function Backdrop({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
      onClick={onClick}
    />
  );
}

// Resolved / accepted / rejected items, hidden behind a collapsible (closed by default) at the bottom
// of each tab so they don't take up space but stay reachable.
function ResolvedCollapsible({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        {open ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        <Check className="size-3.5" />
        Resolved ({count})
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

// The list of annotations. Selecting a card highlights it (border) + its anchor in the document but
// keeps the sidebar open; the tab follows the selected item's type. Each tab shows its active items,
// with resolved ones tucked into a collapsible.
function SidebarBody() {
  const {
    threads,
    messagesByThread,
    suggestions,
    messagesBySuggestion,
    projectId,
    uid,
    canEdit,
    canComment,
    actions,
    activeKey,
    activate,
  } = useAnnotationCtx();

  const [tab, setTab] = useState<"comments" | "suggestions">("comments");
  const [showOnlyMentions, setShowOnlyMentions] = useState(false);
  const [prevActive, setPrevActive] = useState<string | null>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  const unresolvedThreads = useMemo(
    () => threads.filter((t) => !t.resolved),
    [threads],
  );
  // Resolved lists are sorted most-recently-resolved first (active lists keep creation order).
  const resolvedThreads = useMemo(
    () =>
      threads
        .filter((t) => t.resolved)
        .sort(
          (a, b) =>
            new Date(b.resolved_at ?? b.updated_at).getTime() -
            new Date(a.resolved_at ?? a.updated_at).getTime(),
        ),
    [threads],
  );
  const pendingSuggestions = useMemo(
    () => suggestions.filter((s) => s.status === "pending"),
    [suggestions],
  );
  const resolvedSuggestions = useMemo(
    () =>
      suggestions
        .filter((s) => s.status !== "pending")
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        ),
    [suggestions],
  );

  // A thread/suggestion counts as a mention when the current user is @mentioned in it or any reply.
  const isThreadMentioned = useCallback(
    (id: string) =>
      !!uid &&
      (messagesByThread.get(id) ?? []).some((m) => m.mentions.includes(uid)),
    [uid, messagesByThread],
  );
  const isSuggestionMentioned = useCallback(
    (id: string) =>
      !!uid &&
      (messagesBySuggestion.get(id) ?? []).some((m) =>
        m.mentions.includes(uid),
      ),
    [uid, messagesBySuggestion],
  );
  const mentionCount = useMemo(
    () =>
      threads.filter((t) => isThreadMentioned(t.id)).length +
      suggestions.filter((s) => isSuggestionMentioned(s.id)).length,
    [threads, suggestions, isThreadMentioned, isSuggestionMentioned],
  );

  // "Show only mentions" filters every list (active + resolved, both tabs) down to the user's mentions.
  const shownUnresolvedThreads = showOnlyMentions
    ? unresolvedThreads.filter((t) => isThreadMentioned(t.id))
    : unresolvedThreads;
  const shownResolvedThreads = showOnlyMentions
    ? resolvedThreads.filter((t) => isThreadMentioned(t.id))
    : resolvedThreads;
  const shownPendingSuggestions = showOnlyMentions
    ? pendingSuggestions.filter((s) => isSuggestionMentioned(s.id))
    : pendingSuggestions;
  const shownResolvedSuggestions = showOnlyMentions
    ? resolvedSuggestions.filter((s) => isSuggestionMentioned(s.id))
    : resolvedSuggestions;

  // Follow the selected item: switch to its tab so its (selected) card is visible. Adjusted during
  // render — React's recommended alternative to a setState-in-effect. Staying on Mentions is allowed.
  if (activeKey !== prevActive) {
    setPrevActive(activeKey);
    if (activeKey && activeKey !== DRAFT_KEY) {
      if (suggestions.some((s) => s.id === activeKey)) setTab("suggestions");
      else if (threads.some((t) => t.id === activeKey)) setTab("comments");
    }
  }

  // Bring the selected card into view once its tab is showing.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeKey, tab]);

  const commentCard = (t: (typeof threads)[number]) => (
    <div key={t.id} ref={t.id === activeKey ? selectedRef : undefined}>
      <CommentThreadCard
        thread={t}
        messages={messagesByThread.get(t.id) ?? []}
        projectId={projectId}
        uid={uid}
        canEdit={canEdit}
        canComment={canComment}
        actions={actions}
        variant="list"
        selected={t.id === activeKey}
        onSelect={() => activate(t.id)}
      />
    </div>
  );

  const suggestionCard = (s: (typeof suggestions)[number]) => (
    <div key={s.id} ref={s.id === activeKey ? selectedRef : undefined}>
      <SuggestionCard
        suggestion={s}
        messages={messagesBySuggestion.get(s.id) ?? []}
        projectId={projectId}
        uid={uid}
        canEdit={canEdit}
        actions={actions}
        variant="list"
        selected={s.id === activeKey}
        onSelect={() => activate(s.id)}
      />
    </div>
  );

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as "comments" | "suggestions")}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      {uid && (
        <div className="flex shrink-0 items-center border-b border-border px-3 py-2">
          <button
            type="button"
            aria-pressed={showOnlyMentions}
            onClick={() => setShowOnlyMentions((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
              showOnlyMentions
                ? "border-transparent bg-link/15 text-link shadow-sm"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {showOnlyMentions ? (
              <Check className="size-3.5 shrink-0" />
            ) : (
              <AtSign className="size-3.5 shrink-0" />
            )}
            Show only mentions
            {mentionCount > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold leading-none text-link",
                  showOnlyMentions ? "bg-link/25" : "bg-link/15",
                )}
              >
                {mentionCount}
              </span>
            )}
          </button>
        </div>
      )}
      <div className="flex shrink-0 items-center overflow-x-auto border-b border-border px-3 py-2">
        <TabsList className="h-8">
          <TabsTrigger value="comments" className="text-xs">
            Comments
            {shownUnresolvedThreads.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[0.65rem] font-bold text-primary leading-none">
                {shownUnresolvedThreads.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="suggestions" className="text-xs">
            Edit suggestions
            {shownPendingSuggestions.length > 0 && (
              <span className="ml-1 rounded-full bg-accent2/15 px-1.5 py-0.5 text-[0.65rem] font-bold text-accent2 leading-none">
                {shownPendingSuggestions.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="comments"
        className="m-0 flex min-h-0 flex-1 flex-col overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {shownUnresolvedThreads.length === 0 &&
          shownResolvedThreads.length === 0 && (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {showOnlyMentions
                ? "No comments mention you."
                : "No comments yet."}
            </p>
          )}
        <div className="flex flex-col gap-2">
          {shownUnresolvedThreads.map(commentCard)}
        </div>
        {shownResolvedThreads.length > 0 && (
          <ResolvedCollapsible count={shownResolvedThreads.length}>
            {shownResolvedThreads.map(commentCard)}
          </ResolvedCollapsible>
        )}
      </TabsContent>

      <TabsContent
        value="suggestions"
        className="m-0 flex min-h-0 flex-1 flex-col overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {shownPendingSuggestions.length === 0 &&
          shownResolvedSuggestions.length === 0 && (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {showOnlyMentions
                ? "No suggestions mention you."
                : "No suggestions yet."}
            </p>
          )}
        <div className="flex flex-col gap-2">
          {shownPendingSuggestions.map(suggestionCard)}
        </div>
        {shownResolvedSuggestions.length > 0 && (
          <ResolvedCollapsible count={shownResolvedSuggestions.length}>
            {shownResolvedSuggestions.map(suggestionCard)}
          </ResolvedCollapsible>
        )}
      </TabsContent>
    </Tabs>
  );
}

/**
 * The annotation list. Rendered as a docked right rail in normal flow (`listMode === 'sidebar'`:
 * desktops, laptops, landscape tablets — portaled into AppLayout so it shifts content aside) or a
 * full-height bottom sheet (`listMode === 'sheet'`: phones and portrait tablets). Selecting a card
 * never closes it; closing it clears the selection.
 */
export default function AnnotationSidebar() {
  const { sidebarOpen, closeSidebar, listMode } = useAnnotationCtx();
  const { slot: railSlot } = useAnnotationRail();

  const header = (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between border-b border-border",
        // Compact in the rail; roomier in the bottom sheet (gated on listMode, not a width breakpoint,
        // so portrait tablets that show the sheet above md still get the roomier header).
        listMode === "sidebar" ? "px-3 py-[9.5px]" : "px-4 py-3",
      )}
    >
      <span className="text-sm font-semibold">
        Comments &amp; Edit suggestions
      </span>
      <button
        type="button"
        aria-label="Close"
        onClick={closeSidebar}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );

  if (listMode === "sidebar") {
    // Docked rail rendered in normal flow (portaled into AppLayout's flex row), so opening it shifts the
    // document aside exactly like the nav sidebar — not a fixed overlay. The outer element animates its
    // width; the inner fixed-width content is clipped by overflow so it doesn't reflow while opening.
    if (!railSlot) return null;
    return createPortal(
      <aside
        className={cn(
          "flex h-full shrink-0 flex-col overflow-hidden bg-background transition-[width] duration-200 ease-in-out",
          sidebarOpen ? "w-74 xl:w-88 2xl:w-96 border-l border-border" : "w-0",
        )}
      >
        <div className="flex h-full w-74 xl:w-88 2xl:w-96 flex-col">
          {header}
          <SidebarBody />
        </div>
      </aside>,
      railSlot,
    );
  }

  return (
    <>
      {sidebarOpen && <Backdrop onClick={closeSidebar} />}
      <aside
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 flex h-dvh flex-col rounded-t-2xl border-t border-border bg-background shadow-2xl",
          "transition-transform duration-200",
          sidebarOpen ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="flex shrink-0 justify-center pt-2 pb-1">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>
        {header}
        <SidebarBody />
      </aside>
    </>
  );
}
