export const REKLAMATION_STATUSES = [
  'reklamation_eingegangen',
  'reklamation_bestellt',
  'reklamation_abgelehnt',
] as const;

export const SCHLUSS_STATUSES = [
  'schluss_rechnung_erstellt',
  'rest_rechnung_erstellt',
] as const;

// Rechnung records have their own state and do not interrupt this project order.
// The two legacy Rechnung form states remain here for existing records.
export const WORKFLOW_STATUS_ORDER = [
  'entwurf',
  'auftrag_abgelehnt',
  'neu',
  'angebot_ausstehend',
  'angebot_versendet',
  'auftrag_erteilt',
  'rechnung_erstellt',
  'gesendet',
  'bauantrag',
  'anzahlung',
  'bestellt',
  'montage_geplant',
  'montage_gestartet',
  'abnahme',
  ...REKLAMATION_STATUSES,
  ...SCHLUSS_STATUSES,
] as const;

const position = (status: string) => WORKFLOW_STATUS_ORDER.indexOf(
  status as (typeof WORKFLOW_STATUS_ORDER)[number],
);

export const isReklamationStatus = (status: string): boolean =>
  REKLAMATION_STATUSES.includes(status as (typeof REKLAMATION_STATUSES)[number]);

export const isSchlussStatus = (status: string): boolean =>
  SCHLUSS_STATUSES.includes(status as (typeof SCHLUSS_STATUSES)[number]);

export const canEditAufmass = (status: string): boolean => {
  const current = position(status);
  return current >= 0 && current <= position('bauantrag');
};

export const canCreateAdditionalRechnung = (status: string): boolean => {
  if (status === 'papierkorb' || status === 'auftrag_abgelehnt' || isSchlussStatus(status)) return false;
  return position(status) >= position('auftrag_erteilt');
};

export const canCreateSchlussrechnung = (status: string): boolean =>
  status === 'abnahme' || isReklamationStatus(status);

export const canOpenAbnahmeForm = (status: string): boolean =>
  status === 'montage_gestartet' || status === 'abnahme' || isReklamationStatus(status);
