import { useCallback } from 'react';

export interface StatusChangeContext {
  formId: number;
  currentStatus: string;
  newStatus: string;
}

export interface StatusChangeHandlers {
  onAngebotVersendet: (ctx: StatusChangeContext) => void;
  onAuftragErteilt?: (ctx: StatusChangeContext) => void;
  onAnzahlung: (ctx: StatusChangeContext) => void;
  onAbnahme: (ctx: StatusChangeContext) => void;
  onPlainStatus: (ctx: StatusChangeContext) => void;
}

// Central dispatcher for status changes. Caller owns the modal/UI state.
// Routes the change into the matching handler so Dashboard and FormPage
// (Bearbeiten) stay in sync without duplicating switch logic.
export function useStatusChange(handlers: StatusChangeHandlers) {
  return useCallback(
    (ctx: StatusChangeContext) => {
      switch (ctx.newStatus) {
        case 'angebot_versendet':
          handlers.onAngebotVersendet(ctx);
          return;
        case 'auftrag_erteilt':
          if (handlers.onAuftragErteilt) {
            handlers.onAuftragErteilt(ctx);
            return;
          }
          handlers.onPlainStatus(ctx);
          return;
        case 'anzahlung':
          handlers.onAnzahlung(ctx);
          return;
        case 'abnahme':
          handlers.onAbnahme(ctx);
          return;
        default:
          handlers.onPlainStatus(ctx);
      }
    },
    [handlers]
  );
}
