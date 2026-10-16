import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useT, type MessageKey } from "../i18n";
import { EmptyState } from "./primitives";

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  numeric?: boolean;
  sortValue?: (row: T) => string | number | null;
}

/** Sortable table with sticky header; renders nothing fabricated — empty rows show an empty state. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyKey = "state.no_data",
  defaultSort,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyKey?: MessageKey;
  defaultSort?: { column: string; direction: "asc" | "desc" };
  caption?: string;
}) {
  const t = useT();
  const [sort, setSort] = useState(defaultSort || null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find(item => item.id === sort.column);
    if (!column?.sortValue) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = column.sortValue!(a);
      const vb = column.sortValue!(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb)) * factor;
    });
  }, [rows, sort, columns]);

  if (!rows.length) return <EmptyState title={t(emptyKey)} />;

  return (
    <div className="table-wrap">
      <table className="data-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map(column => {
              const sortable = Boolean(column.sortValue);
              const active = sort?.column === column.id;
              return (
                <th
                  key={column.id}
                  className={`${column.numeric ? "num " : ""}${sortable ? "sortable" : ""}`}
                  aria-sort={active ? (sort!.direction === "asc" ? "ascending" : "descending") : undefined}
                >
                  {sortable ? (
                    <button type="button" className="table-sort" onClick={() => setSort({ column: column.id, direction: active && sort!.direction === "desc" ? "asc" : "desc" })}>
                      {column.header}{active ? (sort!.direction === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                  ) : column.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={rowKey(row)}>
              {columns.map(column => (
                <td key={column.id} className={column.numeric ? "num" : ""}>{column.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
