import { Component, type ReactNode } from "react";
import { Link } from "react-router-dom";

/** Keeps one page's failure from blanking the whole site. Keyed by the path,
 *  so moving to another page starts it fresh. */
export class PageGuard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="wrap ss-guard">
        <div className="card">
          <div className="label">Something broke</div>
          <h2>This page could not load.</h2>
          <p className="ss-guard-msg">{this.state.error.message}</p>
          <div className="ss-guard-act"><button className="btn btn-sm" onClick={() => this.setState({ error: null })}>Try again</button> <Link className="btn btn-ghost btn-sm" to="/">Back home</Link></div>
        </div>
      </div>
    );
  }
}
