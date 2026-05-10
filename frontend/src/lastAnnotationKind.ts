const KEY = 'last-annotation-kind';

export function loadLastAnnotationKind(validIds: string[]): string {
  if (validIds.length === 0) return 'note';
  try {
    const v = localStorage.getItem(KEY);
    if (v && validIds.includes(v)) return v;
  } catch {
    // ignore
  }
  return validIds[0]!;
}

export function persistLastAnnotationKind(kind: string) {
  try {
    localStorage.setItem(KEY, kind);
  } catch {
    // ignore
  }
}
