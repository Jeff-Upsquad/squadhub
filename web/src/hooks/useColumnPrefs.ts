import { useMemo } from 'react';
import type { ListViewColumnState } from '@squadhub/shared';
import { usePMStore } from '../stores/pmStore';
import { normalizeColumns, resolveColumns } from '../lib/columns';

/**
 * Effective columns for a view scope.
 * scopeKey examples: `listview:<viewId>`, `list:<id>`, `folder:<id>`, `space:<id>`.
 * Personal override (columnPrefsByScope) wins, else shared view config, else defaults.
 */
export function useColumnPrefs(
  scopeKey: string,
  viewConfigColumns?: ListViewColumnState[] | null,
) {
  const personal = usePMStore((s) => (scopeKey ? s.columnPrefsByScope[scopeKey] : undefined));
  const setScopeColumns = usePMStore((s) => s.setScopeColumns);
  const resetScopeColumns = usePMStore((s) => s.resetScopeColumns);

  const columns = useMemo(
    () => resolveColumns(viewConfigColumns, personal),
    [viewConfigColumns, personal],
  );
  const normalizedPersonal = useMemo(
    () => (personal ? normalizeColumns(personal) : null),
    [personal],
  );

  return {
    columns,
    /** Null when no personal override is stored for this scope. */
    personalOverride: normalizedPersonal,
    hasPersonalOverride: !!personal,
    setColumns: (next: ListViewColumnState[]) => {
      if (scopeKey) setScopeColumns(scopeKey, next);
    },
    resetColumns: () => {
      if (scopeKey) resetScopeColumns(scopeKey);
    },
  };
}
