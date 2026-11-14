/**
 * Turns a failed novel-generation request into something a reader can act on.
 *
 * The rule: only describe a cause the response actually supports. A bare HTTP
 * code is never treated as a content problem, and a content problem is never
 * described as a service outage. When the cause cannot be determined, the
 * wording says so.
 */

const BY_CAUSE = {
  service_unavailable: {
    title: "Temporary service issue",
    message:
      "Your chapter couldn't be generated because the writing service was temporarily unavailable. Your novel has not been changed. You can try again.",
    retryable: true,
    canAdjust: false,
  },
  busy: {
    title: "The service is busy",
    message:
      "The writing service is handling too many requests right now. Your novel has not been changed. Wait a moment and try again.",
    retryable: true,
    canAdjust: false,
  },
  content_restricted: {
    title: "Content limitation",
    message:
      "Part of the requested material couldn't be written into a chapter. Your novel has not been changed. You can adjust the chapter's focus, leave out that material, and try again.",
    retryable: true,
    canAdjust: true,
  },
  empty_response: {
    title: "No chapter came back",
    message:
      "The writing service returned no chapter text. Your novel has not been changed. You can try again, or adjust the focus and try again.",
    retryable: true,
    canAdjust: true,
  },
  save_failed: {
    title: "The chapter couldn't be saved",
    message:
      "The text was written but couldn't be stored, so nothing was added to your novel. Your existing chapters are untouched. You can try again.",
    retryable: true,
    canAdjust: false,
  },
  unexpected: {
    title: "Something went wrong",
    message:
      "The chapter couldn't be generated. Your novel has not been changed. You can try again.",
    retryable: true,
    canAdjust: false,
  },
  connection: {
    title: "Connection problem",
    message:
      "The request didn't reach the writing service. Your novel has not been changed. Check your connection and try again.",
    retryable: true,
    canAdjust: false,
  },
  unauthorized: {
    title: "You're signed out",
    message: "Your session has ended, so the chapter couldn't be written. Sign in again and retry.",
    retryable: true,
    canAdjust: false,
  },
  forbidden: {
    title: "This novel isn't yours to change",
    message: "This novel belongs to another account, so no chapter was written.",
    retryable: false,
    canAdjust: false,
  },
  not_found: {
    title: "That part of the novel no longer exists",
    message: "The novel or chapter being worked on could not be found. Nothing was written.",
    retryable: false,
    canAdjust: false,
  },
};

const STAGE_LABELS = {
  source: "Gathering the information this chapter is built from",
  writing: "Writing the chapter",
  illustrations: "Creating the illustrations",
  saving: "Saving the chapter",
};

export const novelStageLabel = (stage) => STAGE_LABELS[stage] || null;

const build = (cause, extra = {}) => {
  const base = BY_CAUSE[cause] || BY_CAUSE.unexpected;
  return {
    cause,
    title: base.title,
    message: base.message,
    retryable: base.retryable,
    canAdjust: base.canAdjust,
    stage: null,
    technical: "",
    determined: cause !== "unexpected",
    ...extra,
  };
};

export function normalizeNovelError(error, { operation = "continue", direction = "" } = {}) {
  const response = error?.response;
  const status = Number(response?.status || error?.status || 0) || null;
  const data = response?.data;
  const failure = data && typeof data === "object" ? data.failure : null;

  // The generator itself identified the stage and cause — use it as given.
  if (failure && typeof failure === "object") {
    const cause = failure.cause || "unexpected";
    return {
      ...build(cause, {
        title: failure.title || undefined,
        message: failure.message || undefined,
        retryable: failure.retryable !== false,
        canAdjust: !!failure.canAdjust,
        stage: failure.stage || null,
        technical: failure.technical || (status ? `HTTP ${status}` : ""),
        determined: cause !== "unexpected",
      }),
      operation,
      direction,
    };
  }

  if (!response) return { ...build("connection", { technical: error?.message || "" }), operation, direction };

  if (status === 429) return { ...build("busy", { technical: "HTTP 429" }), operation, direction };
  if (status === 401) return { ...build("unauthorized", { technical: "HTTP 401" }), operation, direction };
  if (status === 403) return { ...build("forbidden", { technical: "HTTP 403" }), operation, direction };
  if (status === 404) return { ...build("not_found", { technical: "HTTP 404" }), operation, direction };

  // A 5xx from the platform says the request never produced a result — nothing
  // about the requested content. It must never be reported as a content issue.
  if (status >= 500) {
    return {
      ...build("service_unavailable", {
        technical: `HTTP ${status}${data?.error ? ` — ${data.error}` : ""}`,
      }),
      operation,
      direction,
    };
  }

  // 4xx: the generator's own validation wording is already clear.
  if (status >= 400 && typeof data?.error === "string" && data.error.length < 300) {
    return {
      ...build("unexpected", { message: data.error, stage: null, technical: `HTTP ${status}`, determined: true }),
      operation,
      direction,
    };
  }

  return {
    ...build("unexpected", {
      technical: status ? `HTTP ${status}` : error?.message || "",
      determined: false,
    }),
    operation,
    direction,
  };
}