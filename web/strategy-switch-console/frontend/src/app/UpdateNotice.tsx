import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { consoleBuildChanged } from "./consoleBuild";
import { getNavigationGuard } from "./router";

export function UpdateNotice() {
  const t = useT();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const current = document.querySelector<HTMLMetaElement>('meta[name="qsl-console-build"]')?.content || "";
    let disposed = false;
    let checking = false;
    let checkedAt = 0;
    const check = async () => {
      if (document.visibilityState !== "visible" || checking || Date.now() - checkedAt < 60_000) return;
      checking = true;
      checkedAt = Date.now();
      try {
        if (await consoleBuildChanged(current) && !disposed) setAvailable(true);
      } catch {
        // A failed update check never changes the current screen.
      } finally { checking = false; }
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      disposed = true;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (!available) return null;
  const reload = async () => {
    const guard = getNavigationGuard();
    if (!guard || await guard()) window.location.reload();
  };
  return <div className="update-notice" role="status">
    <span>{t("shell.update_available")}</span>
    <button type="button" className="button button-secondary" onClick={() => void reload()}>{t("shell.reload")}</button>
  </div>;
}
