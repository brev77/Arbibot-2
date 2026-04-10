import { create } from 'zustand';

type OperatorFiltersState = {
  opportunitySearch: string;
  opportunityState: string;
  setOpportunitySearch: (value: string) => void;
  setOpportunityState: (value: string) => void;
};

export const useOperatorFiltersStore = create<OperatorFiltersState>((set) => ({
  opportunitySearch: '',
  opportunityState: '',
  setOpportunitySearch: (opportunitySearch) => set({ opportunitySearch }),
  setOpportunityState: (opportunityState) => set({ opportunityState }),
}));
