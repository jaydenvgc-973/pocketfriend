import React from "react";

/**
 * SectionIsolate
 *
 * Keeps one self-contained panel's render error from taking down the whole page.
 *
 * The Settings page mounts many independent panels (storage, help, admin console,
 * diagnostics, character lists). Before this, a thrown error in ANY of them
 * propagated to the page-level boundary and replaced the entire Settings page
 * with an error screen. With each panel isolated, the page itself always renders
 * and every other panel keeps working. Failed panels are omitted and logged —
 * there is deliberately no fallback message and no replacement page.
 */
export default class SectionIsolate extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error(
      `[Settings] panel "${this.props.name || "unnamed"}" failed to render:`,
      error,
      errorInfo?.componentStack
    );
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}