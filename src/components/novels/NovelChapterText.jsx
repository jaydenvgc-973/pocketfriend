import { Fragment } from "react";

/**
 * Renders a chapter as literary prose: paragraphs with the chapter's illustrations
 * placed inline at the paragraph they belong to — never as a separate gallery.
 */
export default function NovelChapterText({ chapter }) {
  const paragraphs = (chapter?.content || "").split(/\n\s*\n/).filter((p) => p.trim());
  const byParagraph = new Map();
  (chapter?.illustrations || []).forEach((img) => {
    if (!img?.url) return;
    const key = Number(img.after_paragraph) || 1;
    if (!byParagraph.has(key)) byParagraph.set(key, []);
    byParagraph.get(key).push(img);
  });

  return (
    <div className="space-y-5">
      {paragraphs.map((text, index) => (
        <Fragment key={index}>
          <p className="text-[15.5px] leading-[1.85] text-foreground/90 font-serif">
            {text.trim()}
          </p>
          {(byParagraph.get(index + 1) || []).map((img, i) => (
            <figure key={`${index}-${i}`} className="my-6">
              <img
                src={img.url}
                alt={img.caption || ""}
                className="w-full rounded-lg border border-border/60 object-cover"
                loading="lazy"
              />
              {img.caption && (
                <figcaption className="mt-2 text-center text-[11px] italic text-muted-foreground">
                  {img.caption}
                </figcaption>
              )}
            </figure>
          ))}
        </Fragment>
      ))}
    </div>
  );
}