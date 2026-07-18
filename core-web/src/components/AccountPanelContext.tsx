import { createContext, useContext } from "react";

interface OpenAccountPanelOptions {
  flashStatus?: boolean;
}

interface AccountPanelContextValue {
  openAccountPanel: (options?: OpenAccountPanelOptions) => void;
}

const AccountPanelContext = createContext<AccountPanelContextValue>({
  openAccountPanel: () => undefined,
});

export const AccountPanelProvider = AccountPanelContext.Provider;

export function useAccountPanel() {
  return useContext(AccountPanelContext);
}
