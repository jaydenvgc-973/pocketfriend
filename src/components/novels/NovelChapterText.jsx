import { Fragment, useRef } from "react";
import NovelIllustration from "./NovelIllustration";
import useLongPress from "@/hooks/useLongPress";

/**
 * Renders a chapter as literary prose: paragraphs with the chapter's illustrations
 * placed inline at the paragraph they belong to — never as a separate gallery.
 *
 * Each plate carries its own index so a correction can target that one plate.
 *
 * Holding the prose itself (never the title, which keeps its own hidden copy press)
 * opens the chapter's full text for a direct correction. The press only fires on a
 * stationary hold over a paragraph, so tapping, scrolling and ordinary reading are
 * untouched, and the browser's own text selection still works.
 */
export default function NovelChapterText({
  chapter,
  onWhyRegenerate = null,
  regeneratingIndex = null,
  onEditText = null,
}) {
  const paragraphs = (chapter?.content || "").split(/\n\s*\n/).filter((p) => p.trim());
  const pressedParagraph = useRef("");

  const editPress = useLongPress(() => {
    if (!onEditText) return;
    window.getSelection?.()?.removeAllRanges?.();
    onEditText(pressedParagraph.current);
  }, { delay: 650, suppressContextMenu: false });

  const handlePointerDown = (event) => {
    if (!onEditText) return;
    if (!event.target?.closest?.("[data-chapter-prose]")) return;
    editPress.onPointerDown(event);
  };

  // Plate order is the chapter's own order; the index is the plate's identity for a
  // single-plate correction.
  const ordered = (chapter?.illustrations || [])
    .map((img, index) => ({ img, index }))
    .sort((a, b) => (Number(a.img.after_paragraph) || 0) - (Number(b.img.after_paragraph) || 0));

  const byParagraph = new Map();
  ordered.forEach(({ img, index }) => {
    if (!img?.url) return;
    const key = Math.max(1, Number(img.after_paragraph) || 1);
    if (!byParagraph.has(key)) byParagraph.set(key, []);
    byParagraph.get(key).push({ img, index });
  });

  return (
    <div
      className="space-y-5"
      onPointerDown={handlePointerDown}
      onPointerMove={editPress.onPointerMove}
      onPointerUp={editPress.onPointerUp}
      onPointerLeave={editPress.onPointerLeave}
      onPointerCancel={editPress.onPointerCancel}
      onClick={editPress.onClick}
      onContextMenu={editPress.onContextMenu}
    >
      {paragraphs.map((text, index) => (
        <Fragment key={index}>
          <p
            data-chapter-prose=""
            onPointerDown={() => { pressedParagraph.current = text.trim(); }}
            className="text-[15.5px] leading-[1.85] text-foreground/90 font-serif"
          >
            {text.trim()}
          </p>
          {(byParagraph.get(index + 1) || []).map(({ img, index: plateIndex }) => (
            <NovelIllustration
              key={`${index}-${plateIndex}`}
              illustration={img}
              index={plateIndex}
              caption={img.caption}
              onWhyRegenerate={onWhyRegenerate}
              busy={regeneratingIndex === plateIndex}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}