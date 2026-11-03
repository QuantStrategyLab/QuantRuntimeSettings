import { useEffect, useState } from "react";

/** Same 760 px breakpoint as desk.css. */
export function useNarrow(): boolean {
  const query = "(max-width: 760px)";
  const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}
