import type { ReactNode } from "react";
import { DateText } from "./primitives";

export interface TimelineItem {
  id: string;
  time: string | null;
  title: ReactNode;
  detail?: ReactNode;
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ul className="timeline">
      {items.map(item => (
        <li key={item.id}>
          <div>{item.title}</div>
          {item.detail && <div style={{ color: "var(--muted)", fontSize: 13 }}>{item.detail}</div>}
          <div className="timeline-time"><DateText value={item.time} /></div>
        </li>
      ))}
    </ul>
  );
}
