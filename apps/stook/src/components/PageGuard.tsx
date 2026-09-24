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
      <div className="page">
        <p>This page could not be drawn from what the chain returned.</p>
        <p className="muted small mono">{this.state.error.message}</p>
        <p><button className="small" onClick={() => this.setState({ error: null })}>Try again</button> <Link to="/">Back to the street</Link></p>
      </div>
    );
  }
}
