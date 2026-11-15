/**
 * Turns a failed novel-generation request into something a reader can act on.
 *
 * The rule: only describe a cause the response actually supports. A bare HTTP
 * code is never treated as a content problem, a content problem is never
 * described as an outage, and an unknown failure is reported as unknown rather
 * than guessed at. "Leave something out" is only offered once something has
 * actually been identified as the problem.
 */

const BY_CAUSE = {
  timed_out: {
    title: "The chapter didn't finish in time",
    message:
      "Writing the chapter took longer than one request is allowed, so nothing was saved. Your novel has not been changed. Trying again can work, and a narrower focus finishes faster.",
    retryable: true,
    canAdjust: true,
  },
  service_unavailable: {
    title: "The writing service reported an outage",
    message:
      "The writing service itself reported that it was unavailable, so this chapter was not written. Your novel has not been changed. You can try again.",
    retryable: true,
    canAdjust: false,
  },
  busy: {
    title: "The service is busy",
    message:
      "The writing service was handling too many requests at the moment, so this chapter was not written. Your novel has not been changed. Wait a moment and try again.",
    retryable: true,
    canAdjust: false,
  },
  content_restricted: {
    title: "Content limitation",
    message:
      "Part of what this chapter asked for couldn't be written. Your novel has not been changed. You can adjust the chapter's focus and try again.",
    retryable: true,
    canAdjust: true,
  },
  repeated_opening: {
    title: "The chapter came back repeated",
    message:
      "The writing service returned this chapter's own opening again instead of what comes after it, so nothing was added. The opening of this chapter is saved and safe. You can finish it again.",
    retryable: true,
    canAdjust: false,
  },
  empty_response: {
    title: "No chapter came back",
    message:
      "The writing service returned no chapter text. Your novel has not been changed. You can try again, or adjust the focus and try again.",
    retryable: true,
    canAdjust: true,
  },
  unknown: {
    title: "The chapter couldn't be generated",
    message:
      "This chapter could not be generated, and the specific cause could not be identified. Nothing was written to your novel. You can try again.",
    retryable: true,
    canAdjust: false,
  },
  save_failed: {
    title: "The chapter couldn't be saved",
    message:
      "The text was written but couldn't be stored, so nothing was added to your novel. Your existing chapters are untouched. You can try again.",
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
  const base = BY_CAUSE[cause] || BY_CAUSE.unknown;
  return {
    cause,
    title: base.title,
    message: base.message,
    retryable: base.retryable,
    canAdjust: base.canAdjust,
    stage: null,
    technical: "",
    determined: cause !== "unknown",
    ...extra,
  };
};

const TIMEOUT_HINT = /timed? ?out|timeout|deployment_timed_out|deadline/i;

export function normalizeNovelError(error, { operation = "continue", direction = "" } = {}) {
  const response = error?.response;
  const status = Number(response?.status || error?.status || 0) || null;
  const data = response?.data;
  const failure = data && typeof data === "object" ? data.failure : null;

  // The generator itself identified the stage and cause — use it as given.
  if (failure && typeof failure === "object") {
    const cause = failure.cause || "unknown";
    return {
      ...build(cause, {
        title: failure.title || undefined,
        message: failure.message || undefined,
        retryable: failure.retryable !== false,
        canAdjust: !!failure.canAdjust,
        stage: failure.stage || null,
        technical: failure.technical || (status ? `HTTP ${status}` : ""),
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

  // A platform answer that arrived as text (a gateway or request timeout does this).
  const platformText = [typeof data === "string" ? data : data?.error, error?.message]
    .filter((value) => typeof value === "string")
    .join(" ");
  if (status >= 500 && TIMEOUT_HINT.test(platformText)) {
    return {
      ...build("timed_out", { technical: `HTTP ${status}${platformText ? ` — ${platformText.slice(0, 200)}` : ""}` }),
      operation,
      direction,
    };
  }

  // Any other 5xx: the request never produced a result, and nothing in the
  // response identifies why. It is reported as unknown, never as an outage.
  if (status >= 500) {
    return {
      ...build("unknown", {
        technical: `HTTP ${status}${platformText ? ` — ${platformText.slice(0, 200)}` : ""}`,
        determined: false,
      }),
      operation,
      direction,
    };
  }

  // 4xx: the generator's own validation wording is already clear.
  if (status >= 400 && typeof data?.error === "string" && data.error.length < 300) {
    return {
      ...build("unknown", { message: data.error, stage: null, technical: `HTTP ${status}`, determined: true }),
      operation,
      direction,
    };
  }

  return {
    ...build("unknown", {
      technical: status ? `HTTP ${status}` : error?.message || "",
      determined: false,
    }),
    operation,
    direction,
  };
}