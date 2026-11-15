import { Fragment } from "react";
import NovelIllustration from "./NovelIllustration";

/**
 * Renders a chapter as literary prose: paragraphs with the chapter's illustrations
 * placed inline at the paragraph they belong to — never as a separate gallery.
 *
 * Each plate carries its own index so a correction can target that one plate.
 */
export default function NovelChapterText({ chapter, onWhyRegenerate = null, regeneratingIndex = null }) {
  const paragraphs = (chapter?.content || "").split(/\n\s*\n/).filter((p) => p.trim());

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
    <div className="space-y-5">
      {paragraphs.map((text, index) => (
        <Fragment key={index}>
          <p className="text-[15.5px] leading-[1.85] text-foreground/90 font-serif">
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