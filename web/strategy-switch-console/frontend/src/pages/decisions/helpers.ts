export function resolveAccountChoice<T extends { id: string }>(options: T[], selected: string | null | undefined): T | null {
  return options.find(option => option.id === selected) ?? (options.length === 1 ? options[0] : null);
}
