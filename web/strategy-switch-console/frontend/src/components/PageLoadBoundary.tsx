import { Component, type ReactNode } from "react";
import { useT } from "../i18n";

type BoundaryProps = {
  title: string;
  action: string;
  children: ReactNode;
};

type BoundaryState = { failed: boolean };

export class PageLoadErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };
  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  private reload = () => {
    location.reload();
  };

  render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <div className="page-load-error" role="alert">
        <p>{this.props.title}</p>
        <button className="button button-primary" type="button" onClick={this.reload}>
          {this.props.action}
        </button>
      </div>
    );
  }
}

export function PageLoadBoundary({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <PageLoadErrorBoundary title={t("common.page_load_failed")} action={t("shell.reload")}>
      {children}
    </PageLoadErrorBoundary>
  );
}
