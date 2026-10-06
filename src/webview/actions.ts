import { createContext, useContext } from "react";
import type { RpcMethod } from "../shared/bridge";
export type RunAction = (method: RpcMethod, params?: unknown) => Promise<boolean>;
export const Actions = createContext<RunAction>(async () => false);
export const useActions = () => useContext(Actions);
