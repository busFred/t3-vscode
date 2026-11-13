import { createContext, useContext } from "react";

/**
 * Model slug to catalog display name, for rows that render a model the user is not currently using
 * (such as a recorded model switch). Held in context so refreshing the catalog does not invalidate
 * every memoized transcript row.
 */
export const ModelNamesContext = createContext<ReadonlyMap<string, string>>(new Map());

export function useModelName(): (slug: string) => string | undefined {
  const names = useContext(ModelNamesContext);
  return (slug: string) => names.get(slug);
}
