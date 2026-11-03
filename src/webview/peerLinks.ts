import { createContext, useContext } from "react";
import type { PeerLinksState } from "../shared/peerLinks";
export const LinkRequestPeers = createContext<PeerLinksState | undefined>(undefined);
export const useLinkRequestPeers = () => useContext(LinkRequestPeers);
