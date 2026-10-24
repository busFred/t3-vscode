import { createContext, useContext } from "react";

/** Label of the paired remote machine running the active session; null for local sessions. */
export const RemoteSessionContext = createContext<string | null>(null);
export const useRemoteSession = () => useContext(RemoteSessionContext);
